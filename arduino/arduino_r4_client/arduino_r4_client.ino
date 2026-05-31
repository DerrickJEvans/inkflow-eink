/*
  arduino_r4_client.ino
  E-Paper Dashboard Client — Arduino UNO R4 WiFi + Waveshare e-Paper Shield (B)

  Architecture: Low-RAM Direct SPI Streaming & EEPROM Wifi Wizard
  ──────────────────────────────────────────────────────────────────
  Bypasses GxEPD2 buffer allocations to stream HTTP raw 1-bit monochrome E-Ink
  data straight to the screen controller over SPI, fitting Large screens into 32KB RAM.
  Features a built-in Setup Web AP Portal and EEPROM storage to easily configure
  WiFi networks and server hosts dynamically without code changes.

  Physical Switches required for this sketch on Shield (B):
    D11/12/13 DIP Switches -> OFF
    SPI Config Slider     -> ICSP
    VCC Voltage Slider    -> 5V
    Interface (0/1)       -> 0 (4-Wire SPI)
    Display Type (A/B)    -> A (Clearest layout path for your panel)
*/

#include <SPI.h>
#include <WiFiS3.h>
#include <WiFiUdp.h>
#include <EEPROM.h>
#include "config.h"

Epd epd;
WiFiClient client;
WiFiServer server(80); // Global Web Server instance
int nextRefreshSeconds = fallbackSleepSeconds;

// Total bytes needed for a full horizontal 1-bit screen transmission frame
const uint32_t totalImageBytes = (displayWidth * displayHeight) / 8; 

// EEPROM storage structured configuration schema
struct EEPROMConfig {
  char wifi_ssid[33];
  char wifi_pass[65];
  char server_host[65];
  int server_port;
  char device_name[65];
  uint8_t show_connecting; 
  uint32_t magic;
};

EEPROMConfig activeConfig;
const uint32_t CONFIG_MAGIC = 0xDEFAEC20;

WiFiUDP dnsUDP;
const byte DNS_PORT = 53;

#include "font8x8.h"

// Forward declarations
void startSetupWizard();
void processDNS();
void drawSplashDirect(bool isSetup, String ssid, String host, int port);
void drawSetupSplashDirect();
void drawConnectingSplashDirect(String ssid, String host, int port);
String parseUrlParam(String body, String paramName);
String urlDecode(String str);
unsigned char h2d(char hex);

// Reads EEPROM settings, falling back to config.h defaults on first run
void loadConfiguration() {
  EEPROM.get(0, activeConfig);
  
  if (activeConfig.magic != CONFIG_MAGIC) {
    Serial.println(F("[Config] EEPROM unconfigured. Loading fallback defaults from config.h..."));
    
    // Clear and set defaults
    memset(&activeConfig, 0, sizeof(EEPROMConfig));
    
    strncpy(activeConfig.wifi_ssid, default_ssid.c_str(), sizeof(activeConfig.wifi_ssid) - 1);
    strncpy(activeConfig.wifi_pass, default_password.c_str(), sizeof(activeConfig.wifi_pass) - 1);
    strncpy(activeConfig.server_host, default_serverIp.c_str(), sizeof(activeConfig.server_host) - 1);
    activeConfig.server_port = default_serverPort;
    strncpy(activeConfig.device_name, default_deviceName.c_str(), sizeof(activeConfig.device_name) - 1);
    activeConfig.show_connecting = 1; // Show connecting splash on first boot
    activeConfig.magic = CONFIG_MAGIC;
    
    // Save defaults to EEPROM so they persist
    EEPROM.put(0, activeConfig);
    Serial.println(F("[Config] Defaults successfully written to EEPROM."));
  } else {
    Serial.println(F("[Config] Configurations loaded successfully from EEPROM."));
  }
  
  Serial.print(F("[Config] SSID: ")); Serial.println(activeConfig.wifi_ssid);
  Serial.print(F("[Config] Server: ")); Serial.print(activeConfig.server_host);
  Serial.print(F(":")); Serial.println(activeConfig.server_port);
  Serial.print(F("[Config] Device Name: ")); Serial.println(activeConfig.device_name);
}

// Writes active configurations to non-volatile EEPROM
void saveConfiguration(const char* ssidVal, const char* passVal, const char* hostVal, int portVal, const char* nameVal, uint8_t showConnectingVal = 1) {
  memset(&activeConfig, 0, sizeof(EEPROMConfig));
  
  strncpy(activeConfig.wifi_ssid, ssidVal, sizeof(activeConfig.wifi_ssid) - 1);
  strncpy(activeConfig.wifi_pass, passVal, sizeof(activeConfig.wifi_pass) - 1);
  strncpy(activeConfig.server_host, hostVal, sizeof(activeConfig.server_host) - 1);
  activeConfig.server_port = portVal;
  strncpy(activeConfig.device_name, nameVal, sizeof(activeConfig.device_name) - 1);
  activeConfig.show_connecting = showConnectingVal;
  activeConfig.magic = CONFIG_MAGIC;
  
  EEPROM.put(0, activeConfig);
  Serial.println(F("[Config] New configuration written securely to EEPROM."));
}

// ==========================================
//                  SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n--- InkFlow Arduino R4 WiFi Client (Direct Stream) ---"));

  // Lock out unused peripheral selectors on the shield to prevent SPI cross-talk noise
  pinMode(RAM_CS, OUTPUT); digitalWrite(RAM_CS, HIGH);
  pinMode(SD_CS,  OUTPUT); digitalWrite(SD_CS,  HIGH);
  pinMode(EPD_CS, OUTPUT); digitalWrite(EPD_CS, HIGH);

  // Load configuration from EEPROM
  loadConfiguration();

  // 10-Second Serial trigger prompt to allow developers to force reset settings
  Serial.println(F("\n💡 Press 'r' in Serial Monitor within 10 seconds to force clear settings & launch Setup AP Portal..."));
  unsigned long promptStart = millis();
  bool resetPressed = false;
  while (millis() - promptStart < 10000) {
    if (Serial.available() > 0) {
      char c = Serial.read();
      if (c == 'r' || c == 'R') {
        resetPressed = true;
        break;
      }
    }
    delay(10);
  }

  if (resetPressed) {
    Serial.println(F("[Config] Reset key detected! Clearing EEPROM storage..."));
    memset(&activeConfig, 0, sizeof(EEPROMConfig));
    EEPROM.put(0, activeConfig);
    startSetupWizard();
  }

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
  Serial.print(activeConfig.server_host);
  Serial.print(F(":"));
  Serial.println(activeConfig.server_port);

  if (!client.connect(activeConfig.server_host, activeConfig.server_port)) {
    Serial.println(F("[Error] Web Server connection failed."));
    return false;
  }

  // Retrieve hardware MAC address dynamically
  byte mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", 
           mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  Serial.print(F("[WiFi] Dynamic hardware MAC address for InkFlow ID: "));
  Serial.println(macStr);

  // Send standard HTTP GET request with TRMNL headers
  client.print(F("GET /api/display/raw?device="));
  client.print(macStr);
  client.print(F("&width="));
  client.print(displayWidth);
  client.print(F("&height="));
  client.print(displayHeight);
  client.println(F(" HTTP/1.1"));
  client.print(F("Host: "));
  client.println(activeConfig.server_host);
  client.print(F("ID: "));
  client.println(macStr);
  client.print(F("Access-Token: "));
  client.println(macStr); // MAC acts as private API token
  client.print(F("Device-Name: "));
  client.println(activeConfig.device_name);
  client.print(F("FW-Version: "));
  client.println(F("InkFlow-R4-v1.2.0"));
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
  Serial.println(F("Parsing HTTP Headers..."));
  String currentLine = "";
  uint8_t headerState = 0;
  timeout = millis();
  
  while (client.connected() || client.available() > 0) {
    if (client.available() > 0) {
      char c = client.read();
      timeout = millis(); // Reset timeout on incoming text
      
      // Build current line to parse headers
      if (c != '\r' && c != '\n') {
        currentLine += c;
      }
      
      // State machine to find the \r\n\r\n boundary cleanly
      if (headerState == 0 && c == '\r') headerState = 1;
      else if (headerState == 1 && c == '\n') {
        // Line complete, check for custom refresh rate headers
        if (currentLine.startsWith("X-Refresh-Rate:") || currentLine.startsWith("X-Trmnl-Deep-Sleep:")) {
          int colonIdx = currentLine.indexOf(':');
          if (colonIdx != -1) {
            String valStr = currentLine.substring(colonIdx + 1);
            valStr.trim();
            int parsedRate = valStr.toInt();
            if (parsedRate > 0) {
              nextRefreshSeconds = parsedRate;
              Serial.print(F("[Header] Server set refresh rate: "));
              Serial.print(nextRefreshSeconds);
              Serial.println(F(" seconds"));
            }
          }
        }
        currentLine = "";
        headerState = 2;
      }
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
  while (bytesWritten < totalImageBytes) {
    if (client.available() > 0) {
      uint8_t incomingByte = client.read();
      epd.SendData(incomingByte);
      bytesWritten++;
      timeout = millis(); // Reset watchdog
    } 
    else if (!client.connected()) {
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
  Serial.println(activeConfig.wifi_ssid);
  
  // Show connection status splash screen on the E-Ink display only if flagged
  if (activeConfig.show_connecting == 1) {
    drawConnectingSplashDirect(activeConfig.wifi_ssid, activeConfig.server_host, activeConfig.server_port);
    // Clear flag and write back to EEPROM so subsequent sleep-wake boots connect silently in background!
    activeConfig.show_connecting = 0;
    EEPROM.put(0, activeConfig);
  }
  
  if (WiFi.status() == WL_NO_SHIELD) {
    Serial.println(F("[Error] WiFi communication chip missing."));
    return false;
  }

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    WiFi.begin(activeConfig.wifi_ssid, activeConfig.wifi_pass);
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
    Serial.println(F("\n[Error] Unable to connect. Launching Setup AP Portal..."));
    startSetupWizard(); // Endless AP soft loop
    return false;
  }
}

// ==============================================================================
//                  WIFI MANAGER & CAPTIVE AP PORTAL
// ==============================================================================

void startSetupWizard() {
  Serial.println(F("[Setup AP] Starting soft AP mode..."));
  WiFi.disconnect();
  WiFi.end(); // Completely reset the co-processor firmware state
  delay(1000); // Allow co-processor to power down and reboot cleanly
  
  // Render setup instructions onto the E-Ink Screen physically
  drawSetupSplashDirect();
  
  // Start soft Access Point "InkFlow-R4-Setup" with WPA2 security for absolute visibility & stability
  if (!WiFi.beginAP("InkFlow-R4-Setup", "12345678")) {
    Serial.println(F("[Error] AP initialization failed. Restarting board..."));
    delay(2000);
    NVIC_SystemReset();
  }
  
  IPAddress apIP(192, 168, 4, 1);
  Serial.print(F("[Setup AP] AP Started. SSID: InkFlow-R4-Setup, Local Portal IP: "));
  Serial.println(apIP);
  
  // Launch Captive DNS Responder on UDP Port 53
  dnsUDP.begin(DNS_PORT);
  Serial.println(F("[Setup AP] DNS Captive Portal Redirect active on UDP Port 53."));
  
  server.begin();
  
  Serial.println(F("[Setup AP] Listening for connection requests on Port 80..."));
  
  while (true) {
    // Process DNS capture queries
    processDNS();
    
    WiFiClient client = server.available();
    if (client) {
      Serial.println(F("[Web Server] Client connected."));
      String reqMethod = "";
      String reqPath = "";
      String currentLine = "";
      boolean isPost = false;
      int contentLength = 0;
      String reqBody = "";
      
      while (client.connected()) {
        if (client.available()) {
          char c = client.read();
          
          if (c == '\n') {
            currentLine.trim();
            if (currentLine.length() == 0) {
              // End of headers reached. If POST, read the body
              if (isPost && contentLength > 0) {
                for (int i = 0; i < contentLength; i++) {
                  if (client.available() > 0) {
                    reqBody += (char)client.read();
                  } else {
                    delay(1);
                    i--; // wait for characters
                  }
                }
              }
              break;
            }
            
            // Parse Request Line (Method and Path)
            if (currentLine.startsWith("GET ") || currentLine.startsWith("POST ")) {
              int firstSpace = currentLine.indexOf(' ');
              int secondSpace = currentLine.indexOf(' ', firstSpace + 1);
              if (firstSpace != -1) {
                reqMethod = currentLine.substring(0, firstSpace);
                if (secondSpace != -1) {
                  reqPath = currentLine.substring(firstSpace + 1, secondSpace);
                } else {
                  reqPath = currentLine.substring(firstSpace + 1);
                }
              }
              
              if (reqMethod == "POST" && reqPath.startsWith("/save")) {
                isPost = true;
              } else {
                isPost = false;
              }
            } else if (currentLine.startsWith("Content-Length:")) {
              int colonIdx = currentLine.indexOf(':');
              if (colonIdx != -1) {
                String lenStr = currentLine.substring(colonIdx + 1);
                lenStr.trim();
                contentLength = lenStr.toInt();
              }
            }
            currentLine = "";
          } else if (c != '\r') {
            currentLine += c;
          }
        }
      }
      
      if (isPost && reqPath.startsWith("/save") && reqBody.length() > 0) {
        Serial.println(F("[Web Server] Handling POST /save settings..."));
        
        // Parse parameters from urldecoded reqBody
        String parsedSsid = parseUrlParam(reqBody, "manual_ssid");
        String parsedPass = parseUrlParam(reqBody, "password");
        String parsedHost = parseUrlParam(reqBody, "server");
        String parsedPort = parseUrlParam(reqBody, "port");
        String parsedName = parseUrlParam(reqBody, "devicename");
        
        parsedSsid.trim();
        parsedPass.trim();
        parsedHost.trim();
        parsedPort.trim();
        parsedName.trim();
        
        int port = parsedPort.toInt();
        if (port <= 0) port = 5000;
        
        parsedSsid = urlDecode(parsedSsid);
        parsedPass = urlDecode(parsedPass);
        parsedHost = urlDecode(parsedHost);
        parsedName = urlDecode(parsedName);
        
        Serial.print(F("Parsed SSID: ")); Serial.println(parsedSsid);
        Serial.print(F("Parsed Server Host: ")); Serial.println(parsedHost);
        
        // Save to EEPROM
        saveConfiguration(parsedSsid.c_str(), parsedPass.c_str(), parsedHost.c_str(), port, parsedName.c_str());
        
        // Serve a beautiful success response
        client.println(F("HTTP/1.1 200 OK"));
        client.println(F("Content-Type: text/html"));
        client.println(F("Connection: close"));
        client.println();
        client.println(F("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Saved</title>"));
        client.println(F("<style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center;}"));
        client.println(F(".card{background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;max-width:450px;}"));
        client.println(F("h1{color:#818cf8;margin-bottom:15px;}p{color:#94a3b8;line-height:1.6;}</style></head>"));
        client.println(F("<body><div class=\"card\"><h1>Settings Saved Successfully!</h1>"));
        client.print(F("<p>Your InkFlow R4 device is now rebooting to connect to <strong>"));
        client.print(parsedSsid);
        client.println(F("</strong>.</p><p>Check your display console inside Serial Monitor.</p></div></body></html>"));
        
        delay(2000);
        client.stop();
        
        // Perform system reset to restart board fresh under new settings!
        Serial.println(F("[Setup AP] Performing system reset..."));
        delay(500);
        NVIC_SystemReset();
      } else if (reqPath == "/" || reqPath == "/setup" || reqPath == "/index.html") {
        Serial.println(F("[Web Server] Serving setup page..."));
        
        client.println(F("HTTP/1.1 200 OK"));
        client.println(F("Content-Type: text/html"));
        client.println(F("Connection: close"));
        client.println();
        
        // Serve beautiful glassmorphic webpage
        client.println(F("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"><title>InkFlow R4 Setup</title>"));
        client.println(F("<style>:root{--primary:#6366f1;--primary-hover:#4f46e5;--bg:#0f172a;--card-bg:rgba(30,41,59,0.7);--border:rgba(255,255,255,0.1);--text:#f8fafc;--text-muted:#94a3b8;}"));
        client.println(F("*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,system-ui,sans-serif;}"));
        client.println(F("body{background:var(--bg);color:var(--text);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}"));
        client.println(F(".container{width:100%;max-width:500px;background:var(--card-bg);border:1px solid var(--border);backdrop-filter:blur(12px);border-radius:16px;padding:30px;box-shadow:0 10px 25px rgba(0,0,0,0.3);}"));
        client.println(F(".header{text-align:center;margin-bottom:25px;}.header h1{font-size:24px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#a5b4fc,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}"));
        client.println(F(".header p{font-size:14px;color:var(--text-muted);}.form-group{margin-bottom:20px;}.form-group label{display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);text-transform:uppercase;}"));
        client.println(F(".form-group input,.form-group select{width:100%;padding:12px 16px;background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:15px;outline:none;}"));
        client.println(F(".form-group input:focus,.form-group select:focus{border-color:var(--primary);}.btn-submit{width:100%;padding:14px;background:var(--primary);border:none;border-radius:8px;color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:all 0.2s;}"));
        client.println(F(".btn-submit:hover{background:var(--primary-hover);}.footer{text-align:center;margin-top:25px;font-size:12px;color:var(--text-muted);}</style></head>"));
        client.println(F("<body><div class=\"container\"><div class=\"header\"><h1>InkFlow R4 Setup</h1><p>Configure wireless networks & InkFlow server</p></div>"));
        client.println(F("<form action=\"/save\" method=\"POST\"><div class=\"form-group\"><label>WiFi SSID</label><input type=\"text\" id=\"manual_ssid\" name=\"manual_ssid\" placeholder=\"WiFi name\" required></div>"));
        client.println(F("<div class=\"form-group\"><label>WiFi Password</label><input type=\"password\" name=\"password\" placeholder=\"Password\"></div>"));
        client.println(F("<div class=\"form-group\"><label>InkFlow Server Host / IP</label><input type=\"text\" name=\"server\" placeholder=\"e.g. 192.168.1.122 or mypi.local\" required></div>"));
        client.println(F("<div class=\"form-group\"><label>Port Bind</label><input type=\"number\" name=\"port\" value=\"5000\" required></div>"));
        client.println(F("<div class=\"form-group\"><label>Device custom name</label><input type=\"text\" name=\"devicename\" value=\"Living Room R4 Panel\"></div>"));
        client.println(F("<button type=\"submit\" class=\"btn-submit\">Save Settings & Connect</button></form>"));
        
        byte mac[6];
        WiFi.macAddress(mac);
        char macStr[18];
        snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
        client.print(F("<div class=\"footer\">Device MAC Address: "));
        client.print(macStr);
        client.println(F("</div></div></body></html>"));
        
        delay(50); // Give the browser time to receive the HTML page
        client.stop();
      } else {
        // Redirect captive network checks and other requests to /
        Serial.print(F("[Web Server] Redirecting captive probe path: "));
        Serial.print(reqPath);
        Serial.println(F(" to http://192.168.4.1/"));
        
        client.println(F("HTTP/1.1 302 Found"));
        client.println(F("Location: http://192.168.4.1/"));
        client.println(F("Content-Length: 0"));
        client.println(F("Connection: close"));
        client.println();
        
        delay(50); // Give the browser time to receive the redirect headers
        client.stop();
      }
    }
    delay(2);
  }
}

// Zero-dependency DNS Redirect responder over UDP port 53
void processDNS() {
  int packetSize = dnsUDP.parsePacket();
  if (packetSize > 0) {
    uint8_t packetBuffer[512];
    dnsUDP.read(packetBuffer, 512);
    
    // Check if it's a valid DNS query (at least a header of 12 bytes)
    if (packetSize >= 12) {
      // Modify header for response:
      // Flags: Set QR (Query Response) to 1, Opcode to 0, AA (Authoritative) to 1, RCODE to 0 -> 0x8400
      packetBuffer[2] = 0x84; 
      packetBuffer[3] = 0x00;
      
      // Answer RRs: 1 (set high byte to 0, low byte to 1) -> 0x0001
      packetBuffer[6] = 0x00;
      packetBuffer[7] = 0x01;
      
      // Parse Query Name to find where it ends
      int nameIdx = 12;
      while (nameIdx < packetSize && packetBuffer[nameIdx] != 0) {
        nameIdx += packetBuffer[nameIdx] + 1;
      }
      nameIdx++; // skip null byte
      nameIdx += 4; // skip Query Type (2 bytes) and Query Class (2 bytes)
      
      // Construct Response packet:
      // We will send back the original query part (up to nameIdx) + the Answer record
      dnsUDP.beginPacket(dnsUDP.remoteIP(), dnsUDP.remotePort());
      dnsUDP.write(packetBuffer, nameIdx);
      
      // Answer Record:
      // Pointer to Query Name (0xC00C offset) -> 2 bytes
      dnsUDP.write((uint8_t)0xC0);
      dnsUDP.write((uint8_t)0x0C);
      
      // Type: A record (0x0001) -> 2 bytes
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x01);
      
      // Class: IN (0x0001) -> 2 bytes
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x01);
      
      // TTL: 10 seconds (0x0000000A) -> 4 bytes
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x0A);
      
      // Data Length: 4 bytes (0x0004) -> 2 bytes
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x04);
      
      // IP Address: 192.168.4.1 -> 4 bytes
      dnsUDP.write((uint8_t)192);
      dnsUDP.write((uint8_t)168);
      dnsUDP.write((uint8_t)4);
      dnsUDP.write((uint8_t)1);
      
      dnsUDP.endPacket();
      Serial.println(F("[DNS Portal] Captive Redirect standard request routed to 192.168.4.1"));
    }
  }
}

// Direct-SPI Splash screen renderer utilizing zero-RAM buffering (reads font on-the-fly)
void drawSplashDirect(bool isSetup, String ssid, String host, int port) {
  Serial.println(F("[Display] Drawing splash screen direct to SPI..."));
  
  if (epd.Init() != 0) {
     Serial.println(F("[Error] Display initialization step failed."));
     return;
  }

  // Tell display to prepare for binary pixel input array stream
  epd.SendCommand(0x24);

  struct TextElement {
    const char* text;
    int pixelX;
    int pixelY;
    int scale;
  };
  
  char macStr[18];
  byte mac[6];
  WiFi.macAddress(mac);
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  
  char macLine[40];
  snprintf(macLine, sizeof(macLine), "MAC Address: %s", macStr);

  char ssidLine[40];
  snprintf(ssidLine, sizeof(ssidLine), "SSID: %s", ssid.c_str());
  char hostLine[40];
  snprintf(hostLine, sizeof(hostLine), "Host: %s", host.c_str());
  char portLine[40];
  snprintf(portLine, sizeof(portLine), "Port: %d", port);

  TextElement elements[15];
  int numElements = 0;

  if (isSetup) {
    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow R4 Setup Portal", 40, 40, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 70, 1};
      elements[numElements++] = {"1. Connect your phone or PC to the setup WiFi network:", 40, 110, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 80, 140, 2};
      elements[numElements++] = {"WiFi Password: 12345678", 80, 175, 1};
      elements[numElements++] = {"2. The setup wizard should open automatically.", 40, 220, 1};
      elements[numElements++] = {"   If it does not, open a web browser and visit:", 40, 240, 1};
      elements[numElements++] = {"http://192.168.4.1", 80, 270, 2};
      elements[numElements++] = {"3. Choose your WiFi network, enter password, and configure", 40, 320, 1};
      elements[numElements++] = {"   the InkFlow server IP (e.g. 192.168.1.122) and port.", 40, 340, 1};
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"InkFlow R4 Setup", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {"1. Connect phone/PC to WiFi:", 20, 70, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 40, 90, 2};
      elements[numElements++] = {"Password: 12345678", 40, 115, 1};
      elements[numElements++] = {"2. Open web browser and visit:", 20, 135, 1};
      elements[numElements++] = {"http://192.168.4.1", 40, 155, 2};
      elements[numElements++] = {"3. Set home WiFi & server IP.", 20, 200, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"InkFlow R4 Setup", 10, 10, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 10, 35, 1};
      elements[numElements++] = {"Password: 12345678", 10, 50, 1};
      elements[numElements++] = {"Visit: http://192.168.4.1", 10, 70, 1};
      elements[numElements++] = {"Submit WiFi/Server details!", 10, 90, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  } else {
    // Connecting Splash
    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow Dashboard Connecting...", 40, 40, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 70, 1};
      elements[numElements++] = {"Attempting to connect to WiFi & InkFlow server...", 40, 110, 1};
      elements[numElements++] = {ssidLine, 60, 150, 1};
      elements[numElements++] = {hostLine, 60, 180, 1};
      elements[numElements++] = {portLine, 60, 210, 1};
      elements[numElements++] = {"Please wait, the screen will refresh once connected.", 40, 260, 1};
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"Connecting...", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {ssidLine, 20, 80, 1};
      elements[numElements++] = {hostLine, 20, 110, 1};
      elements[numElements++] = {portLine, 20, 140, 1};
      elements[numElements++] = {"Refreshing shortly...", 20, 180, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"Connecting...", 10, 10, 1};
      elements[numElements++] = {ssidLine, 10, 35, 1};
      elements[numElements++] = {hostLine, 10, 60, 1};
      elements[numElements++] = {portLine, 10, 85, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  }

  // Row and column bounds for border spacing
  int border1 = 5;
  int border2 = 10;
  if (displayWidth < 800) {
    border1 = 3;
    border2 = 6;
  }
  if (displayWidth < 400) {
    border1 = 2;
    border2 = 4;
  }

  for (int y = 0; y < displayHeight; y++) {
    for (int bx = 0; bx < displayWidth / 8; bx++) {
      uint8_t outByte = 0xFF; // Start with all white (1)

      for (int bit = 0; bit < 8; bit++) {
        int x = (bx * 8) + bit;
        bool isBlack = false;

        // 1. Draw elegant double borders
        if ((y >= border1 && y <= border1 + 1) || (y >= displayHeight - (border1 + 2) && y <= displayHeight - border1)) {
          if (x >= border1 && x <= displayWidth - (border1 + 1)) isBlack = true;
        }
        if ((x >= border1 && x <= border1 + 1) || (x >= displayWidth - (border1 + 2) && x <= displayWidth - border1)) {
          if (y >= border1 && y <= displayHeight - border1) isBlack = true;
        }

        if ((y >= border2 && y <= border2 + 1) || (y >= displayHeight - (border2 + 2) && y <= displayHeight - border2)) {
          if (x >= border2 && x <= displayWidth - (border2 + 1)) isBlack = true;
        }
        if ((x >= border2 && x <= border2 + 1) || (x >= displayWidth - (border2 + 2) && x <= displayWidth - border2)) {
          if (y >= border2 && y <= displayHeight - border2) isBlack = true;
        }

        // 2. Render Text elements
        if (!isBlack) {
          for (int e = 0; e < numElements; e++) {
            TextElement& elem = elements[e];
            int scale = elem.scale;
            int charHeight = 8 * scale;

            if (y >= elem.pixelY && y < elem.pixelY + charHeight) {
              int yOffset = y - elem.pixelY;
              int fontRow = yOffset / scale;

              int textLen = strlen(elem.text);
              int charWidth = 8 * scale;
              int totalWidth = textLen * charWidth;

              if (x >= elem.pixelX && x < elem.pixelX + totalWidth) {
                int xOffset = x - elem.pixelX;
                int charIndex = xOffset / charWidth;
                int fontCol = (xOffset / scale) % 8;

                char c = elem.text[charIndex];
                // In font8x8_basic: LSB (bit 0) represents the first pixel in the row
                uint8_t fontByte = font8x8_basic[(uint8_t)c][fontRow];

                if ((fontByte >> fontCol) & 1) {
                  isBlack = true;
                }
              }
            }
          }
        }

        if (isBlack) {
          outByte &= ~(0x80 >> bit); // Clear bit (0 = black)
        }
      }

      epd.SendData(outByte);
    }
  }

  // Trigger global physical E-Paper refresh sequence
  Serial.println(F("[Display] Triggering global hardware refresh transitions..."));
  epd.SendCommand(0x22); 
  epd.SendData(0xF7); 
  epd.SendCommand(0x20); 
  epd.ReadBusy();
  epd.Sleep();
  
  Serial.println(F("[Display] Splash drawn successfully."));
}

void drawSetupSplashDirect() {
  drawSplashDirect(true, "", "", 0);
}

void drawConnectingSplashDirect(String ssid, String host, int port) {
  drawSplashDirect(false, ssid, host, port);
}

// Helper function to extract URL-encoded form parameters
String parseUrlParam(String body, String paramName) {
  int nameIdx = body.indexOf(paramName + "=");
  if (nameIdx == -1) return "";
  
  int valStart = nameIdx + paramName.length() + 1;
  int valEnd = body.indexOf('&', valStart);
  if (valEnd == -1) valEnd = body.length();
  
  return body.substring(valStart, valEnd);
}

// Simple URL decoding utility
String urlDecode(String str) {
  String decoded = "";
  char c;
  char code0;
  char code1;
  for (int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (c == '+') {
      decoded += ' ';
    } else if (c == '%') {
      i++;
      code0 = str.charAt(i);
      i++;
      code1 = str.charAt(i);
      c = (h2d(code0) << 4) | h2d(code1);
      decoded += c;
    } else {
      decoded += c;
    }
  }
  return decoded;
}

unsigned char h2d(char hex) {
  if (hex >= '0' && hex <= '9') return hex - '0';
  if (hex >= 'a' && hex <= 'f') return hex - 'a' + 10;
  if (hex >= 'A' && hex <= 'F') return hex - 'A' + 10;
  return 0;
}
