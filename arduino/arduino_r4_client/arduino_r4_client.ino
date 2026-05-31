/*
  arduino_r4_client.ino
  E-Paper Dashboard Client — Arduino UNO R4 WiFi + Waveshare e-Paper Shield (B)

  Architecture: Low-RAM Direct SPI Streaming & EEPROM Wifi Wizard
  ──────────────────────────────────────────────────────────────────
  Bypasses GxEPD2 buffer allocations to stream HTTP raw 1-bit monochrome E-Ink
  data straight to the screen controller over SPI, fittingLarge screens into 32KB RAM.
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
#include <EEPROM.h>
#include "config.h"

Epd epd;
WiFiClient client;
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
  uint32_t magic;
};

EEPROMConfig activeConfig;
const uint32_t CONFIG_MAGIC = 0xDEFAEC20;

// Forward declarations
void startSetupWizard();
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
void saveConfiguration(const char* ssidVal, const char* passVal, const char* hostVal, int portVal, const char* nameVal) {
  memset(&activeConfig, 0, sizeof(EEPROMConfig));
  
  strncpy(activeConfig.wifi_ssid, ssidVal, sizeof(activeConfig.wifi_ssid) - 1);
  strncpy(activeConfig.wifi_pass, passVal, sizeof(activeConfig.wifi_pass) - 1);
  strncpy(activeConfig.server_host, hostVal, sizeof(activeConfig.server_host) - 1);
  activeConfig.server_port = portVal;
  strncpy(activeConfig.device_name, nameVal, sizeof(activeConfig.device_name) - 1);
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
  delay(100);
  
  // Start soft Access Point "InkFlow-R4-Setup"
  if (!WiFi.beginAP("InkFlow-R4-Setup")) {
    Serial.println(F("[Error] AP initialization failed. Restarting board..."));
    delay(2000);
    NVIC_SystemReset();
  }
  
  IPAddress apIP(192, 168, 4, 1);
  Serial.print(F("[Setup AP] AP Started. SSID: InkFlow-R4-Setup, Local Portal IP: "));
  Serial.println(apIP);
  
  WiFiServer server(80);
  server.begin();
  
  Serial.println(F("[Setup AP] Listening for connection requests on Port 80..."));
  
  while (true) {
    WiFiClient client = server.available();
    if (client) {
      Serial.println(F("[Web Server] Client connected."));
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
            
            // Check request type
            if (currentLine.startsWith("GET /")) {
              isPost = false;
            } else if (currentLine.startsWith("POST /save")) {
              isPost = true;
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
      
      if (isPost && reqBody.length() > 0) {
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
      } else {
        Serial.println(F("[Web Server] Serving setup page..."));
        
        // WiFi scan networks
        int numNetworks = WiFi.scanNetworks();
        String wifiOptions = "";
        for (int i = 0; i < numNetworks; i++) {
          String s = WiFi.SSID(i);
          int32_t r = WiFi.RSSI(i);
          wifiOptions += "<option value=\"" + s + "\">" + s + " (" + String(r) + " dBm)</option>\n";
        }
        
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
        client.println(F("<form action=\"/save\" method=\"POST\"><div class=\"form-group\"><label>Scanned Networks</label>"));
        client.println(F("<select onchange=\"document.getElementById('manual_ssid').value = this.value\"><option value=\"\">-- Select Network --</option>"));
        client.print(wifiOptions);
        client.println(F("</select></div><div class=\"form-group\"><label>WiFi SSID (or Manual Entry)</label><input type=\"text\" id=\"manual_ssid\" name=\"manual_ssid\" placeholder=\"WiFi name\" required></div>"));
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
        
        client.stop();
      }
    }
    delay(2);
  }
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
