/*
  arduino_r4_client.ino
  E-Paper Dashboard Client — Arduino UNO R4 WiFi + Waveshare e-Paper Shield (B)

  Architecture: Low-RAM Direct SPI Streaming
  ──────────────────────────────────────────
  Bypasses the unreliable GxEPD2 library entirely. This script utilizes the working
  native Waveshare driver architecture ("epd4in26.h") to stream incoming HTTP image 
  bytes straight to the screen controller over SPI. The R4's RAM never holds more 
  than a few bytes at a time, preventing RAM overflow errors.

  Physical Switches required for this sketch on Shield (B):
    D11/12/13 DIP Switches -> OFF
    SPI Config Slider     -> ICSP
    VCC Voltage Slider    -> 5V
    Interface (0/1)       -> 0 (4-Wire SPI)
    Display Type (A/B)    -> A (Clearest layout path for your panel)
*/

#include <SPI.h>
#include <WiFiS3.h>
#include "epd4in26.h"     // Native working Waveshare driver

// ==========================================
//           CONFIGURATION SETTINGS
// ==========================================

// WiFi Settings
const char* ssid     = "PLUSNET-TQC29S";
const char* password = "KtYAvLrd4bvuE9";

// Server Settings (Your Raspberry Pi's local IP address)
const char* serverIp   = "192.168.1.122";
const int   serverPort = 5000;

// Device Specifications (deviceId is dynamically fetched from your hardware MAC address at boot)
const int   displayWidth       = 800;   // Seeed KEGM042601M01 4.26" panel
const int   displayHeight      = 480;   // Seeed KEGM042601M01 4.26" panel

// Default refresh interval (seconds) if server header is missing
const int fallbackSleepSeconds = 30;

// Hardwired Pin mappings
#define EPD_CS    10
#define RAM_CS    5   
#define SD_CS     6   

Epd epd;
WiFiClient client;
int nextRefreshSeconds = fallbackSleepSeconds;

// Total bytes needed for a full horizontal 1-bit screen transmission frame
// (800 width * 480 height) / 8 bits = 48000 bytes
const uint32_t totalImageBytes = 48000; 

// ==========================================
//                  SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n--- TRMNL Pi Arduino R4 WiFi Client (Direct Stream) ---"));

  // Lock out unused peripheral selectors on the shield to prevent SPI cross-talk noise
  pinMode(RAM_CS, OUTPUT); digitalWrite(RAM_CS, HIGH);
  pinMode(SD_CS,  OUTPUT); digitalWrite(SD_CS,  HIGH);
  pinMode(EPD_CS, OUTPUT); digitalWrite(EPD_CS, HIGH);

  // Initialize WiFi connection
  if (connectWiFi()) {
    // Connect to server and stream incoming byte data directly to e-Paper RAM
    if (fetchAndStreamDisplay()) {
      Serial.println(F("[Success] Screen updated."));
    } else {
      Serial.println(F("[Warning] Display fetch or stream failed."));
    }
    
    // Shut down radios safely to conserve energy
    WiFi.disconnect();
    WiFi.end();
  }
  
  // Safe Deep sleep loop simulation block
  Serial.print(F("Entering deep wait loop phase: "));
  Serial.print(nextRefreshSeconds);
  Serial.println(F(" seconds..."));
  
  // Convert seconds to millisecond system delays
  for(int i = 0; i < nextRefreshSeconds; i++) {
    delay(1000);
  }
  
  // Force R4 board level software restart to run the execution loop fresh
  Serial.println(F("Restarting script environment..."));
  NVIC_SystemReset(); 
}

void loop() {
  // Setup block uses an absolute execution loop structure; loop remains empty.
}

// ==========================================
//          CORE STREAMING FUNCTIONS
// ==========================================

bool fetchAndStreamDisplay() {
  Serial.print(F("Connecting to server pipeline: "));
  Serial.print(serverIp);
  Serial.print(F(":"));
  Serial.println(serverPort);

  if (!client.connect(serverIp, serverPort)) {
    Serial.println(F("[Error] Web Server connection failed."));
    return false;
  }

  // Retrieve hardware MAC address dynamically
  byte mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", 
           mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  Serial.print(F("[WiFi] Dynamic hardware MAC address for TRMNL ID: "));
  Serial.println(macStr);

  // Send standard HTTP GET request with TRMNL headers
  client.print(F("GET /api/display?device="));
  client.print(macStr);
  client.println(F(" HTTP/1.1"));
  client.print(F("Host: "));
  client.println(serverIp);
  client.print(F("ID: "));
  client.println(macStr);
  client.print(F("Access-Token: "));
  client.println(macStr); // MAC acts as private API token
  client.print(F("FW-Version: "));
  client.println(F("1.2.0"));
  client.print(F("RSSI: "));
  client.println(WiFi.RSSI());
  client.println(F("Connection: close"));
  client.println();

  // Wait for the server to start responding
  unsigned long timeout = millis();
  while (client.available() == 0) {
    if (millis() - timeout > 5000) {
      Serial.println(F("[Error] Client HTTP connection timeout."));
      client.stop();
      return false;
    }
  }

  // --- NEW FIXED HEADER PARSER ---
  // We read the incoming data byte-by-byte looking for the sequence \r\n\r\n 
  // (Carriage Return, Line Feed, Carriage Return, Line Feed), which marks the end of HTTP headers.
  Serial.println(F("Parsing HTTP Headers..."));
  uint8_t headerState = 0;
  timeout = millis();
  
  while (client.connected() || client.available() > 0) {
    if (client.available() > 0) {
      char c = client.read();
      timeout = millis(); // Reset timeout on incoming text
      
      // State machine to find the \r\n\r\n boundary cleanly
      if (headerState == 0 && c == '\r') headerState = 1;
      else if (headerState == 1 && c == '\n') headerState = 2;
      else if (headerState == 2 && c == '\r') headerState = 3;
      else if (headerState == 3 && c == '\n') {
        Serial.println(F("[Header] Found boundary safely. Switching to Binary Stream."));
        break; // Successfully skipped headers; the next byte is pure image data!
      }
      else {
        headerState = 0; // Reset if the sequence breaks
      }
    }
    if (millis() - timeout > 3000) {
      Serial.println(F("[Error] Timeout waiting for header boundary."));
      client.stop();
      return false;
    }
  }

  // Initialise E-Paper controller lines
  Serial.println(F("Initializing E-Paper controller lines..."));
  if (epd.Init() != 0) {
     Serial.println(F("[Error] Display initialization step failed."));
     client.stop();
     return false;
  }

  // Tell display to prepare for binary pixel input array stream
  epd.SendCommand(0x24);

  uint32_t bytesWritten = 0;
  timeout = millis();

  Serial.println(F("Streaming raw image packets directly to screen RAM..."));
  
  // --- DIRECT BINARY STREAM LOOP ---
  // Now that headers are gone, every single byte read is a raw pixel packet
  while (bytesWritten < totalImageBytes) {
    if (client.available() > 0) {
      uint8_t incomingByte = client.read();
      epd.SendData(incomingByte);
      bytesWritten++;
      timeout = millis(); // Reset watchdog
    } 
    else if (!client.connected()) {
      // Server dropped or ended connection early
      break;
    }
    else if (millis() - timeout > 4000) {
      Serial.println(F("[Error] Stream timed out mid-frame."));
      break;
    }
  }
  
  client.stop();
  Serial.print(F("[Data] Stream closed. Total bytes sent to screen: "));
  Serial.println(bytesWritten);

  // AUTO-PADDING SAFETY CATCH:
  // If the server short-changed us, fill the rest of the 800x480 frame with white rows
  if (bytesWritten < totalImageBytes) {
    uint32_t missingBytes = totalImageBytes - bytesWritten;
    Serial.print(F("[Padding] Filling remaining "));
    Serial.print(missingBytes);
    Serial.println(F(" bytes with white rows..."));
    
    for (uint32_t p = 0; p < missingBytes; p++) {
      epd.SendData(0xFF); 
    }
    bytesWritten = totalImageBytes;
  }

  // Trigger the physical refresh sequence
  Serial.println(F("Triggering global hardware refresh transitions..."));
  epd.SendCommand(0x22); 
  epd.SendData(0xF7); 
  epd.SendCommand(0x20); 
  
  epd.ReadBusy();
  epd.Sleep();
  
  return true;
}


bool connectWiFi() {
  Serial.print(F("Attempting to connect to SSID Network: "));
  Serial.println(ssid);
  
  if (WiFi.status() == WL_NO_SHIELD) {
    Serial.println(F("[Error] WiFi communication chip missing."));
    return false;
  }

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    WiFi.begin(ssid, password);
    delay(4000);
    Serial.print(F("."));
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\n[WiFi] Connection successful!"));
    Serial.print(F("[WiFi] Assigned Local IP Address: "));
    Serial.println(WiFi.localIP());
    return true;
  } else {
    Serial.println(F("\n[Error] Unable to associate with local WiFi route."));
    return false;
  }
}
