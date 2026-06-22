/*
  arduino_client.ino - E-Paper Dashboard Client for ESP32 & Waveshare HAT
  
  Downloads raw 1-bit monochrome horizontal bit-packed byte arrays from
  the InkFlow E-Ink server and displays them on Waveshare E-Paper screens.
  
  Uses GxEPD2: Install via Arduino Library Manager (GxEPD2 & Adafruit GFX)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <GxEPD2_3C.h> // Supports 3-color (Black/White/Red) or monochrome screens
#include <GxEPD2_BW.h> // Supports monochrome (Black/White) screens
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

#include "config.h"

// Allocate buffer to hold the downloaded raw 1-bit pixel bitmap
// Calculated as: (width * height) / 8 bytes.
// E.g., 400 * 300 / 8 = 15,000 bytes (15 KB), easily fits in ESP32's 320 KB RAM.
const int bufferSize = (displayWidth * displayHeight) / 8;
uint8_t* imageBuffer = nullptr;

// Dynamic Configuration variables loaded from Preferences or config.h
String activeSsid;
String activePassword;
String activeServerIp;
int activeServerPort;
String activeDeviceName;

Preferences preferences;
WebServer server(80);
DNSServer dnsServer;

const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);

// Forward declarations
void startSetupWizard();
void drawSetupSplash();
void drawConnectingSplash(String ssid, String host, int port);

// Load settings from Preferences or fall back to config.h
void loadConfiguration() {
  preferences.begin("inkflow", false);
  
  activeSsid = preferences.getString("wifi_ssid", "");
  activePassword = preferences.getString("wifi_pass", "");
  activeServerIp = preferences.getString("server_host", "");
  activeServerPort = preferences.getInt("server_port", 0);
  activeDeviceName = preferences.getString("device_name", "");
  
  preferences.end();
  
  // Fall back to hardcoded config.h defaults if Preferences are unconfigured/empty
  if (activeSsid == "") {
    activeSsid = default_ssid;
    activePassword = default_password;
    Serial.println("[Config] Stored WiFi SSID not found, loaded default_ssid from config.h");
  } else {
    Serial.println("[Config] Loaded WiFi settings from Preferences");
  }
  
  if (activeServerIp == "") {
    activeServerIp = default_serverIp;
    activeServerPort = default_serverPort;
    Serial.println("[Config] Stored Server IP not found, loaded default_serverIp from config.h");
  } else {
    Serial.println("[Config] Loaded Server settings from Preferences");
  }
  
  if (activeDeviceName == "") {
    activeDeviceName = default_deviceName;
    Serial.println("[Config] Stored Device Name not found, loaded default_deviceName from config.h");
  } else {
    Serial.println("[Config] Loaded Device Name from Preferences");
  }
  
  Serial.printf("[Config] Active SSID: %s\n", activeSsid.c_str());
  Serial.printf("[Config] Active Server: %s:%d\n", activeServerIp.c_str(), activeServerPort);
  Serial.printf("[Config] Active Device Name: %s\n", activeDeviceName.c_str());
}

// Save settings to non-volatile Preferences
void saveConfiguration(String newSsid, String newPass, String newHost, int newPort, String newName) {
  preferences.begin("inkflow", false);
  
  preferences.putString("wifi_ssid", newSsid);
  preferences.putString("wifi_pass", newPass);
  preferences.putString("server_host", newHost);
  preferences.putInt("server_port", newPort);
  preferences.putString("device_name", newName);
  
  preferences.end();
  Serial.println("[Config] New configurations saved securely to Preferences!");
}

// Symmetrical PROGMEM stream loop to load a local fallback diagnostic screen when offline
void loadLocalFallbackImage() {
  Serial.println("[Local Stream] Loading fallback diagnostic screen from flash memory...");
  
  for (uint32_t i = 0; i < bufferSize; i++) {
    uint32_t pixelIndex = i * 8;
    uint32_t col = pixelIndex % displayWidth;
    uint32_t row = pixelIndex / displayWidth;
    
    // Create checkerboard blocks (64x64 blocks)
    if (((row / 64) + (col / 64)) % 2 == 0) {
      if (row % 16 == 0 || col % 16 == 0) {
        imageBuffer[i] = 0x00; // Paint Black gridlines
      } else {
        imageBuffer[i] = 0xAA; // Dithered diagnostic gray fill (10101010)
      }
    } else {
      if (row % 16 == 0 || col % 16 == 0) {
        imageBuffer[i] = 0x00; // Paint Black gridlines
      } else {
        imageBuffer[i] = 0xFF; // Paint White fill (11111111)
      }
    }
  }
  Serial.println("[Local Stream] Diagnostic fallback screen loaded.");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n--- InkFlow ESP32 Client Awake ---");

  // CRITICAL SPI BUS PROTECTION:
  // Disables the onboard Flash chip (Pin 5) and SD Card (Pin 4) on the Waveshare E-Paper Shield
  // to protect the hardware SPI lines from package collision/corruption.
  pinMode(5, OUTPUT);
  digitalWrite(5, HIGH); // Pull Flash CS HIGH to disable it
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH); // Pull SD CS HIGH to disable it

  // Load Preferences configurations
  loadConfiguration();

  // 10-Second Serial trigger prompt to allow developers to force reset settings
  Serial.println("\n💡 Press 'r' in Serial Monitor within 10 seconds to force clear settings & launch Setup AP Portal...");
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
    Serial.println("[Config] Reset key detected! Clearing Preferences storage...");
    preferences.begin("inkflow", false);
    preferences.clear();
    preferences.end();
    startSetupWizard();
  }

  // Allocate memory for buffer
  imageBuffer = (uint8_t*)malloc(bufferSize);
  if (imageBuffer == nullptr) {
    Serial.println("[Error] Failed to allocate RAM for screen buffer!");
    goToSleep(fallbackSleepSeconds);
  }
  memset(imageBuffer, 0xFF, bufferSize); // Pre-fill with White (0xFF)

  // Connect to WiFi
  connectWiFi();

  // Download raw screen data
  int sleepSeconds = downloadRawDisplayBytes();

  // If download succeeded, push to screen. Otherwise, load local diagnostic grid!
  if (sleepSeconds > 0) {
    updateDisplay();
  } else {
    Serial.println("[Warning] Fetch failed. Loading local dithered fallback from Flash memory.");
    loadLocalFallbackImage();
    updateDisplay();
    sleepSeconds = fallbackSleepSeconds;
  }

  // Release RAM
  free(imageBuffer);

  // Enter deep sleep
  goToSleep(sleepSeconds);
}

void loop() {
  // Loop is unused as ESP32 wakes up from deep sleep, runs setup(), and sleeps again.
}

void connectWiFi() {
  Serial.printf("Connecting to WiFi SSID: %s\n", activeSsid.c_str());
  WiFi.begin(activeSsid.c_str(), activePassword.c_str());
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) { // 15 seconds timeout
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP Address: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection timeout. Launching InkFlow E-Ink Setup Wizard...");
    startSetupWizard(); // Enters loop, hosting configuration Web AP portal
  }
}

int downloadRawDisplayBytes() {
  if (WiFi.status() != WL_CONNECTED) return -1;
  
  HTTPClient http;
  
  // Retrieve hardware MAC address dynamically
  String macAddress = WiFi.macAddress();
  Serial.printf("[WiFi] Fetching dynamic MAC address for InkFlow ID: %s\n", macAddress.c_str());
  
  // Construct request URL using dynamic MAC as the deviceId
  char url[256];
  snprintf(url, sizeof(url), "http://%s:%d/api/display/raw?device=%s&width=%d&height=%d", 
           activeServerIp.c_str(), activeServerPort, macAddress.c_str(), displayWidth, displayHeight);
           
  Serial.printf("[HTTP] Fetching raw stream: %s\n", url);
  
  http.begin(url);
  
  // Register custom headers to collect from the server response
  const char* collectHeaders[] = {"X-Refresh-Rate", "X-Trmnl-Deep-Sleep"};
  http.collectHeaders(collectHeaders, 2);
 
  // Add official telemetry headers
  http.addHeader("ID", macAddress);
  http.addHeader("Access-Token", macAddress); // MAC acts as private API token
  http.addHeader("Device-Name", activeDeviceName);
  http.addHeader("FW-Version", "InkFlow-ESP32-v1.2.0");
  http.addHeader("RSSI", String(WiFi.RSSI()));
  
  // Symmetrical read of battery voltage (common divider is on GPIO 34 for ESP32)
  float voltage = 3.70;
  #ifdef ESP32
    int rawAnalog = analogRead(34);
    if (rawAnalog > 0) {
      voltage = (rawAnalog / 4095.0) * 2.0 * 3.3 * 1.1; // Standard scaling calculation
    }
  #endif
  
  // Format voltage string (e.g. "3.82V")
  char voltStr[16];
  dtostrf(voltage, 4, 2, voltStr);
  String batteryVoltage = String(voltStr) + "V";
  http.addHeader("Battery-Voltage", batteryVoltage);
  
  Serial.printf("[HTTP] Pinging server with telemetry: RSSI=%d dBm, Battery=%s\n", WiFi.RSSI(), batteryVoltage.c_str());

  int httpCode = http.GET();
  int sleepTime = fallbackSleepSeconds;
  
  if (httpCode == HTTP_CODE_OK) {
    int len = http.getSize();
    Serial.printf("[HTTP] Connected, stream size: %d bytes (Buffer expected: %d)\n", len, bufferSize);
    
    // Check if server returned custom sleep interval header
    if (http.hasHeader("X-Refresh-Rate")) {
      String rate = http.header("X-Refresh-Rate");
      sleepTime = rate.toInt();
      Serial.printf("[HTTP] Server set refresh rate: %d seconds\n", sleepTime);
    }
    
    WiFiClient* stream = http.getStreamPtr();
    int bytesRead = 0;
    
    // Read raw binary payload directly into our buffer
    while (http.connected() && bytesRead < bufferSize && (len > 0 || len == -1)) {
      size_t sizeAvail = stream->available();
      if (sizeAvail) {
        int readLen = min((int)sizeAvail, bufferSize - bytesRead);
        int c = stream->readBytes(imageBuffer + bytesRead, readLen);
        bytesRead += c;
      }
      delay(1);
    }
    
    Serial.printf("[HTTP] Downloaded %d bytes of raw screen pixel buffer.\n", bytesRead);
    http.end();
    
    if (bytesRead >= bufferSize) {
      return sleepTime;
    } else {
      Serial.println("[Error] Buffer stream truncated! Size mismatch.");
      return -1;
    }
  } else {
    Serial.printf("[HTTP] GET failed, server response code: %d\n", httpCode);
    http.end();
    return -1;
  }
}

void updateDisplay() {
  Serial.println("[Display] Initializing GxEPD2 SPI interface...");
  display.init(115200); // 115200 baud for SPI logging
  
  Serial.println("[Display] Pushing raw dithered horizontal bitmap page-by-page...");
  
  display.firstPage();
  do {
    display.drawBitmap(0, 0, imageBuffer, displayWidth, displayHeight, GxEPD_BLACK, GxEPD_WHITE);
  } while (display.nextPage());
  
  // Delay to let physical pixels stabilize and charge pump voltages settle before powering off
  delay(2000);
  
  Serial.println("[Display] Powering down e-ink display SPI panel...");
  display.powerOff();
  Serial.println("[Display] Screen updated successfully!");
}

void goToSleep(int seconds) {
  Serial.printf("[Power] Entering Deep Sleep for %d seconds...\n", seconds);
  
  // Configure ESP32 deep sleep timer
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  
  // Power down WiFi radio
  WiFi.disconnect(true);
  
  // Sleep
  esp_deep_sleep_start();
}

// ==============================================================================
//                  WIFI MANAGER & CAPTIVE PORTAL WIZARD
// ==============================================================================

void handleRoot() {
  Serial.println("[Web Server] Handling root setup request...");
  
  // Scan local WiFi networks
  int numNetworks = WiFi.scanNetworks();
  String wifiOptions = "";
  for (int i = 0; i < numNetworks; ++i) {
    String scannedSsid = WiFi.SSID(i);
    int32_t rssi = WiFi.RSSI(i);
    wifiOptions += "<option value=\"" + scannedSsid + "\">" + scannedSsid + " (" + String(rssi) + " dBm)</option>\n";
  }
  
  String html = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InkFlow E-Ink Setup Wizard</title>
  <style>
    :root {
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --bg: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.7);
      --border: rgba(255, 255, 255, 0.1);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 500px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }
    .header {
      text-align: center;
      margin-bottom: 25px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
      background: linear-gradient(135deg, #a5b4fc, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header p {
      font-size: 14px;
      color: var(--text-muted);
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .form-group input, .form-group select {
      width: 100%;
      padding: 12px 16px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 15px;
      outline: none;
      transition: all 0.2s ease;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }
    .btn-submit {
      width: 100%;
      padding: 14px;
      background: var(--primary);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 10px;
      box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.2);
    }
    .btn-submit:hover {
      background: var(--primary-hover);
      box-shadow: 0 4px 12px -1px rgba(99, 102, 241, 0.3);
    }
    .footer {
      text-align: center;
      margin-top: 25px;
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>InkFlow Setup Wizard</h1>
      <p>Configure wireless network and server connections</p>
    </div>
    
    <form action="/save" method="POST">
      <div class="form-group">
        <label for="ssid">Scanned WiFi Networks</label>
        <select id="ssid" name="ssid" onchange="document.getElementById('manual_ssid').value = this.value">
          <option value="">-- Select Network --</option>
  )rawliteral" + wifiOptions + R"rawliteral(
        </select>
      </div>

      <div class="form-group">
        <label for="manual_ssid">WiFi SSID (or Manual Entry)</label>
        <input type="text" id="manual_ssid" name="manual_ssid" placeholder="Enter WiFi SSID" required>
      </div>
      
      <div class="form-group">
        <label for="password">WiFi Password</label>
        <input type="password" id="password" name="password" placeholder="Enter WiFi Password">
      </div>
      
      <div class="form-group">
        <label for="server">InkFlow Server Host / IP</label>
        <input type="text" id="server" name="server" placeholder="e.g. 192.168.1.122 or mydns.local" required>
      </div>
      
      <div class="form-group">
        <label for="port">Server Port</label>
        <input type="number" id="port" name="port" value="5000" placeholder="5000" required>
      </div>
      
      <div class="form-group">
        <label for="devicename">Custom Device Name</label>
        <input type="text" id="devicename" name="devicename" value="Living Room ESP32 Panel" placeholder="e.g. Kitchen Display">
      </div>
      
      <button type="submit" class="btn-submit">Save Settings & Connect</button>
    </form>
    
    <div class="footer">
      Device MAC Address: )rawliteral" + WiFi.macAddress() + R"rawliteral(
    </div>
  </div>
</body>
</html>
  )rawliteral";
  
  server.send(200, "text/html", html);
}

void handleSave() {
  Serial.println("[Web Server] Handling save request...");
  String ssid = server.arg("manual_ssid");
  String pass = server.arg("password");
  String host = server.arg("server");
  String portStr = server.arg("port");
  String devName = server.arg("devicename");
  
  int port = portStr.toInt();
  if (port <= 0) port = 5000;
  
  ssid.trim();
  pass.trim();
  host.trim();
  devName.trim();
  
  if (ssid == "" || host == "") {
    server.send(400, "text/plain", "[Error] WiFi SSID and Server Host are required parameters.");
    return;
  }
  
  String responseHtml = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Saved</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      text-align: center;
      padding: 20px;
    }
    .card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 450px;
    }
    h1 { color: #818cf8; margin-bottom: 15px; font-size: 22px; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 20px; }
    .loader {
      border: 4px solid rgba(255,255,255,0.1);
      border-top: 4px solid #6366f1;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto 0;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Settings Saved Successfully!</h1>
    <p>Your InkFlow E-Ink device is now connecting to <strong>)rawliteral" + ssid + R"rawliteral(</strong>.</p>
    <p>Please check your E-Paper display. It will refresh to show connection status shortly.</p>
    <div class="loader"></div>
  </div>
</body>
</html>
  )rawliteral";
  
  server.send(200, "text/html", responseHtml);
  
  delay(1000);
  
  // Save new parameters securely to non-volatile memory
  saveConfiguration(ssid, pass, host, port, devName);
  
  // Reload parameters into active variables
  loadConfiguration();
  
  // Draw connecting splash
  drawConnectingSplash(activeSsid, activeServerIp, activeServerPort);
  
  // Stop captive server & AP
  server.stop();
  WiFi.softAPdisconnect(true);
  
  // Attempt connection
  WiFi.begin(activeSsid.c_str(), activePassword.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected to new configurations!");
    int sleepSeconds = downloadRawDisplayBytes();
    if (sleepSeconds > 0) {
      updateDisplay();
    } else {
      loadLocalFallbackImage();
      updateDisplay();
      sleepSeconds = fallbackSleepSeconds;
    }
    free(imageBuffer);
    goToSleep(sleepSeconds);
  } else {
    Serial.println("\n[WiFi] Connection to new configurations failed! Going back to AP Setup Portal.");
    ESP.restart(); // Easy clean AP reboot
  }
}

void startSetupWizard() {
  Serial.println("[Setup Portal] Launching local Setup Access Point...");
  
  // Clear any existing connections
  WiFi.disconnect();
  delay(100);
  
  // Render setup instructions onto E-Ink Screen
  drawSetupSplash();
  
  // Start Soft AP "InkFlow-Setup"
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP("InkFlow-Setup");
  
  Serial.print("[Setup Portal] AP Started. SSID: InkFlow-Setup, IP Address: ");
  Serial.println(WiFi.softAPIP().toString());
  
  // Start DNS Server (captures all portal checks)
  dnsServer.start(DNS_PORT, "*", apIP);
  
  // Configure Web routes
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  
  // Android / iOS Captive Portal Redirect endpoints
  server.on("/generate_204", handleRoot);  // Android redirect
  server.on("/fwlink", handleRoot);        // Windows redirect
  server.onNotFound([]() {
    // Redirect all unknown HTTP requests to captive portal root
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  
  server.begin();
  Serial.println("[Setup Portal] Captive portal web server launched successfully.");
  
  // Serve Captive Portal loop
  while (true) {
    dnsServer.processNextRequest();
    server.handleClient();
    delay(2);
  }
}

void drawSetupSplash() {
  Serial.println("[Display] Drawing setup wizard splash screen...");
  display.init(115200);
  
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    
    // Draw outer double border
    display.drawRect(5, 5, displayWidth - 10, displayHeight - 10, GxEPD_BLACK);
    display.drawRect(8, 8, displayWidth - 16, displayHeight - 16, GxEPD_BLACK);
    
    // Header
    display.setTextSize(2);
    display.setTextColor(GxEPD_BLACK);
    display.setCursor(25, 35);
    display.print("InkFlow E-Ink Setup");
    
    // Sub-header
    display.setTextSize(1);
    display.setCursor(25, 60);
    display.print("Configure your wireless device portal:");
    
    // Divider
    display.drawLine(20, 70, displayWidth - 20, 70, GxEPD_BLACK);
    
    // Step 1
    display.setCursor(25, 95);
    display.print("1. Connect your phone/PC to setup WiFi network:");
    
    display.setTextSize(2);
    display.setCursor(45, 125);
    display.print("InkFlow-Setup");
    
    // Step 2
    display.setTextSize(1);
    display.setCursor(25, 155);
    display.print("2. The settings page should open automatically.");
    display.setCursor(25, 170);
    display.print("   Otherwise, open a browser and go to:");
    
    display.setTextSize(2);
    display.setCursor(45, 200);
    display.print("http://192.168.4.1");
    
    // Step 3
    display.setTextSize(1);
    display.setCursor(25, 230);
    display.print("3. Enter your local WiFi details & InkFlow server details!");
    
    // Footer / MAC
    display.drawLine(20, displayHeight - 40, displayWidth - 20, displayHeight - 40, GxEPD_BLACK);
    display.setCursor(25, displayHeight - 25);
    display.print("Device MAC Address: " + WiFi.macAddress());
    
  } while (display.nextPage());
  
  display.powerOff();
  Serial.println("[Display] Setup splash drawn successfully!");
}

void drawConnectingSplash(String ssid, String host, int port) {
  Serial.println("[Display] Drawing connecting status splash screen...");
  display.init(115200);
  
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    
    display.drawRect(5, 5, displayWidth - 10, displayHeight - 10, GxEPD_BLACK);
    
    display.setTextSize(2);
    display.setCursor(25, 40);
    display.print("Connecting Screen...");
    
    display.setTextSize(1);
    display.setCursor(25, 75);
    display.print("Applying new credentials and establishing link:");
    
    display.drawLine(20, 90, displayWidth - 20, 90, GxEPD_BLACK);
    
    display.setCursor(25, 120);
    display.print("📡 WiFi SSID:  " + ssid);
    
    display.setCursor(25, 145);
    display.print("🌐 Server IP:  " + host);
    
    display.setCursor(25, 170);
    display.print("🔌 Port Bind:  " + String(port));
    
    display.setCursor(25, 205);
    display.print("Please wait up to 15 seconds for connection...");
    
    display.drawLine(20, displayHeight - 40, displayWidth - 20, displayHeight - 40, GxEPD_BLACK);
    display.setCursor(25, displayHeight - 25);
    display.print("MAC Address: " + WiFi.macAddress());
    
  } while (display.nextPage());
  
  display.powerOff();
  Serial.println("[Display] Connecting splash drawn.");
}
