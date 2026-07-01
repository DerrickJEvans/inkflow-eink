/*
  portal_server.h - Web portal AP configuration server for XIAO Client
*/

#ifndef PORTAL_SERVER_H
#define PORTAL_SERVER_H

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include "config.h"
#include "config_manager.h"
#include "system_utils.h"
#include "graphics_drawing.h"

extern WebServer server;
extern DNSServer dnsServer;
extern const byte DNS_PORT;
extern String scannedSSIDs[20];
extern int scannedSSIDCount;
extern String lastConnectionError;
extern IPAddress apIP;

inline void handleRoot() {
  Serial.println(F("[Web Server] Handling root setup request..."));
  
  // Scan local WiFi networks
  int numNetworks = WiFi.scanNetworks();
  String wifiOptions = "";
  int limit = min(numNetworks, 20);
  scannedSSIDCount = limit;
  for (int i = 0; i < limit; ++i) {
    String scannedSsid = WiFi.SSID(i);
    scannedSSIDs[i] = scannedSsid;
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
  )rawliteral";

  if (lastConnectionError.length() > 0) {
    html += "<div style=\"background:#ef4444;border:1px solid #dc2626;border-radius:8px;padding:12px;margin-bottom:20px;font-size:14px;color:#fff;text-align:left;\">⚠️ " + lastConnectionError + "</div>";
  }

  html += R"rawliteral(
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
        <div style="position: relative;">
          <input type="password" id="password" name="password" placeholder="Enter WiFi Password" style="width:100%; padding-right: 60px;">
          <button type="button" id="togglePassword" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; font-weight: 600; outline: none;">Show</button>
        </div>
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
        <input type="text" id="devicename" name="devicename" value="XIAO ePaper Status Panel" placeholder="e.g. Kitchen Display">
      </div>
      
      <button type="submit" class="btn-submit">Save Settings & Connect</button>
    </form>
    
    <div class="footer">
      Device MAC Address: )rawliteral" + WiFi.macAddress() + R"rawliteral(
    </div>
  </div>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      const passwordInput = document.getElementById("password");
      const togglePassword = document.getElementById("togglePassword");
      if (passwordInput && togglePassword) {
        togglePassword.addEventListener("click", function() {
          if (passwordInput.type === "password") {
            passwordInput.type = "text";
            togglePassword.textContent = "Hide";
          } else {
            passwordInput.type = "password";
            togglePassword.textContent = "Show";
          }
        });
      }
    });
  </script>
</body>
</html>
  )rawliteral";
  
  server.send(200, "text/html", html);
}

inline void handleSave() {
  Serial.println(F("[Web Server] Handling POST /save settings..."));
  
  String ssid = server.arg("manual_ssid");
  String pass = server.arg("password");
  String host = server.arg("server");
  String portStr = server.arg("port");
  String deviceName = server.arg("devicename");
  
  ssid.trim();
  pass.trim();
  host.trim();
  portStr.trim();
  deviceName.trim();
  
  int portVal = portStr.toInt();
  if (portVal <= 0) portVal = 5000;
  
  saveConfiguration(ssid.c_str(), pass.c_str(), host.c_str(), portVal, deviceName.c_str());
  
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Saved</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      text-align: center;
    }
    .card {
      background: rgba(30,41,59,0.7);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 450px;
    }
    h1 { color: #818cf8; margin-bottom: 15px; }
    p { color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Settings Saved Successfully!</h1>
    <p>Your InkFlow XIAO device is now rebooting to connect to <strong>)rawliteral" + ssid + R"rawliteral(</strong>.</p>
    <p>Please check your E-Paper display. It will refresh to show connection status shortly.</p>
  </div>
</body>
</html>
  )rawliteral";
  
  server.send(200, "text/html", html);
  delay(2000);
  
  ESP.restart();
}

inline void startSetupWizard() {
  drawScanSplashDirect();
  
  Serial.println(F("[Setup AP] Starting soft AP mode..."));
  WiFi.disconnect(true);
  delay(500);

  drawSetupSplashDirect(lastConnectionError);

  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP("InkFlow-Setup")) {
    Serial.println(F("[Error] AP initialization failed. Restarting board..."));
    delay(2000);
    ESP.restart();
  }
  
  Serial.print(F("[Setup AP] AP Started. SSID: InkFlow-Setup, Local Portal IP: "));
  Serial.println(WiFi.softAPIP());
  
  dnsServer.start(DNS_PORT, "*", apIP);
  Serial.println(F("[Setup AP] DNS Captive Portal Redirect active on UDP Port 53."));
  
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/generate_204", handleRoot);
  server.on("/fwlink", handleRoot);
  server.onNotFound([]() {
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  
  server.begin();
  Serial.println(F("[Setup AP] Listening for connection requests on Port 80..."));
  
  bool clientConnected = false;
  
  while (true) {
    dnsServer.processNextRequest();
    server.handleClient();
    
    int numStations = WiFi.softAPgetStationNum();
    if (numStations > 0 && !clientConnected) {
      clientConnected = true;
      Serial.println(F("[Setup AP] Detected client connection. Swapping screen to Portal URL QR..."));
      drawPortalSplashDirect();
    }
    
    delay(2);
  }
}

inline bool connectWiFi() {
  Serial.print(F("Attempting to connect to SSID Network: "));
  Serial.println(activeConfig.wifi_ssid);
  
  if (activeConfig.show_connecting == 1) {
    drawConnectingSplashDirect(activeConfig.wifi_ssid, activeConfig.server_host, activeConfig.server_port);
    
    Preferences prefs;
    prefs.begin("inkflow", false);
    prefs.putUChar("show_conn", 0);
    prefs.end();
    
    activeConfig.show_connecting = 0;
  }
  
  WiFi.begin(activeConfig.wifi_ssid, activeConfig.wifi_pass);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(F("."));
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\n[WiFi] Connection successful!"));
    Serial.print(F("[WiFi] Assigned Local IP Address: "));
    Serial.println(WiFi.localIP());
    return true;
  } else {
    Serial.println(F("\n[Error] WiFi connection failed. Launching Setup AP Portal..."));
    lastConnectionError = "Failed to connect to network '" + String(activeConfig.wifi_ssid) + "'. Check password and signal strength.";
    drawErrorSplashDirect("WiFi Connection Failed", "SSID: " + String(activeConfig.wifi_ssid), "Check network or credentials!");
    delay(5000);
    startSetupWizard();
    return false;
  }
}

#endif // PORTAL_SERVER_H
