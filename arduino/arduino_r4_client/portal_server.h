/*
  portal_server.h - Web portal AP configuration server for Arduino UNO R4 Client
*/

#ifndef PORTAL_SERVER_H
#define PORTAL_SERVER_H

#include <Arduino.h>
#include <WiFiS3.h>
#include <WiFiUdp.h>
#include "config.h"
#include "config_manager.h"
#include "system_utils.h"
#include "graphics_drawing.h"

extern Epd epd;
extern WiFiClient client;
extern WiFiServer server;
extern WiFiUDP dnsUDP;
extern const byte DNS_PORT;
extern String scannedSSIDs[20];
extern int scannedSSIDCount;
extern String lastConnectionError;

// Zero-dependency DNS Redirect responder over UDP port 53
inline void processDNS() {
  int packetSize = dnsUDP.parsePacket();
  if (packetSize > 0) {
    uint8_t packetBuffer[512];
    dnsUDP.read(packetBuffer, 512);
    
    // Check if it's a valid DNS query (at least a header of 12 bytes)
    if (packetSize >= 12) {
      // Modify header for response:
      packetBuffer[2] = 0x84; 
      packetBuffer[3] = 0x00;
      
      packetBuffer[6] = 0x00;
      packetBuffer[7] = 0x01;
      
      // Parse Query Name to find where it ends
      int nameIdx = 12;
      while (nameIdx < packetSize && packetBuffer[nameIdx] != 0) {
        nameIdx += packetBuffer[nameIdx] + 1;
      }
      nameIdx++; // skip null byte
      nameIdx += 4; // skip Query Type (2 bytes) and Query Class (2 bytes)
      
      dnsUDP.beginPacket(dnsUDP.remoteIP(), dnsUDP.remotePort());
      dnsUDP.write(packetBuffer, nameIdx);
      
      // Answer Record:
      dnsUDP.write((uint8_t)0xC0);
      dnsUDP.write((uint8_t)0x0C);
      
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x01);
      
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x01);
      
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x0A);
      
      dnsUDP.write((uint8_t)0x00);
      dnsUDP.write((uint8_t)0x04);
      
      dnsUDP.write((uint8_t)192);
      dnsUDP.write((uint8_t)168);
      dnsUDP.write((uint8_t)4);
      dnsUDP.write((uint8_t)1);
      
      dnsUDP.endPacket();
      Serial.println(F("[DNS Portal] Captive Redirect standard request routed to 192.168.4.1"));
    }
  }
}

// Scans and hosts the softAP captive wizard
inline void startSetupWizard() {
  drawScanSplashDirect();

  Serial.println(F("[Setup AP] Scanning for nearby WiFi networks first..."));
  scannedSSIDCount = 0;
  
  int n = WiFi.scanNetworks();
  if (n > 0) {
    scannedSSIDCount = n;
    if (scannedSSIDCount > 20) {
      scannedSSIDCount = 20;
    }
    for (int i = 0; i < scannedSSIDCount; i++) {
      scannedSSIDs[i] = WiFi.SSID(i);
      Serial.print(F("Found SSID: ")); Serial.println(scannedSSIDs[i]);
    }
  } else {
    Serial.println(F("[Setup AP] No networks found or scan failed."));
  }

  Serial.println(F("[Setup AP] Starting soft AP mode..."));
  WiFi.disconnect();
  WiFi.end(); // Completely reset the co-processor firmware state
  delay(1000); 
  
  drawSetupSplashDirect(lastConnectionError);
  
  if (!WiFi.beginAP("InkFlow-R4-Setup", "12345678")) {
    Serial.println(F("[Error] AP initialization failed. Restarting board..."));
    delay(2000);
    NVIC_SystemReset();
  }
  
  IPAddress apIP(192, 168, 4, 1);
  Serial.print(F("[Setup AP] AP Started. SSID: InkFlow-R4-Setup, Local Portal IP: "));
  Serial.println(apIP);
  
  dnsUDP.begin(DNS_PORT);
  Serial.println(F("[Setup AP] DNS Captive Portal Redirect active on UDP Port 53."));
  
  server.begin();
  Serial.println(F("[Setup AP] Listening for connection requests on Port 80..."));
  
  bool clientConnected = false;
  
  while (true) {
    processDNS();
    
    WiFiClient webClient = server.available();
    if (webClient) {
      if (!clientConnected) {
        clientConnected = true;
        Serial.println(F("[Setup AP] Client connected. Swapping screen to Portal URL QR..."));
        drawPortalSplashDirect();
      }
      Serial.println(F("[Web Server] Client connected."));
      String reqMethod = "";
      String reqPath = "";
      String currentLine = "";
      boolean isPost = false;
      int contentLength = 0;
      String reqBody = "";
      
      while (webClient.connected()) {
        if (webClient.available()) {
          char c = webClient.read();
          
          if (c == '\n') {
            currentLine.trim();
            if (currentLine.length() == 0) {
              if (isPost && contentLength > 0) {
                for (int i = 0; i < contentLength; i++) {
                  if (webClient.available() > 0) {
                    reqBody += (char)webClient.read();
                  } else {
                    delay(1);
                    i--;
                  }
                }
              }
              break;
            }
            
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
        
        int portVal = parsedPort.toInt();
        if (portVal <= 0) portVal = 5000;
        
        parsedSsid = urlDecode(parsedSsid);
        parsedPass = urlDecode(parsedPass);
        parsedHost = urlDecode(parsedHost);
        parsedName = urlDecode(parsedName);
        
        Serial.print(F("Parsed SSID: ")); Serial.println(parsedSsid);
        Serial.print(F("Parsed Server Host: ")); Serial.println(parsedHost);
        
        saveConfiguration(parsedSsid.c_str(), parsedPass.c_str(), parsedHost.c_str(), portVal, parsedName.c_str());
        
        webClient.println(F("HTTP/1.1 200 OK"));
        webClient.println(F("Content-Type: text/html"));
        webClient.println(F("Connection: close"));
        webClient.println();
        webClient.println(F("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Saved</title>"));
        webClient.println(F("<style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center;}"));
        webClient.println(F(".card{background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;max-width:450px;}"));
        webClient.println(F("h1{color:#818cf8;margin-bottom:15px;}p{color:#94a3b8;line-height:1.6;}</style></head>"));
        webClient.println(F("<body><div class=\"card\"><h1>Settings Saved Successfully!</h1>"));
        webClient.print(F("<p>Your InkFlow R4 device is now rebooting to connect to <strong>"));
        webClient.print(parsedSsid);
        webClient.println(F("</strong>.</p><p>Check your display console inside Serial Monitor.</p></div></body></html>"));
        
        delay(2000);
        webClient.stop();
        
        Serial.println(F("[Setup AP] Performing system reset..."));
        delay(500);
        NVIC_SystemReset();
      } else if (reqPath == "/" || reqPath == "/setup" || reqPath == "/index.html") {
        Serial.println(F("[Web Server] Serving setup page..."));
        
        webClient.println(F("HTTP/1.1 200 OK"));
        webClient.println(F("Content-Type: text/html"));
        webClient.println(F("Connection: close"));
        webClient.println();
        
        webClient.println(F("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"><title>InkFlow R4 Setup</title>"));
        webClient.println(F("<style>:root{--primary:#6366f1;--primary-hover:#4f46e5;--bg:#0f172a;--card-bg:rgba(30,41,59,0.7);--border:rgba(255,255,255,0.1);--text:#f8fafc;--text-muted:#94a3b8;}"));
        webClient.println(F("*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,system-ui,sans-serif;}"));
        webClient.println(F("body{background:var(--bg);color:var(--text);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}"));
        webClient.println(F(".container{width:100%;max-width:500px;background:var(--card-bg);border:1px solid var(--border);backdrop-filter:blur(12px);border-radius:16px;padding:30px;box-shadow:0 10px 25px rgba(0,0,0,0.3);}"));
        webClient.println(F(".header{text-align:center;margin-bottom:25px;}.header h1{font-size:24px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#a5b4fc,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}"));
        webClient.println(F(".header p{font-size:14px;color:var(--text-muted);}.form-group{margin-bottom:20px;}.form-group label{display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);text-transform:uppercase;}"));
        webClient.println(F(".form-group input,.form-group select{width:100%;padding:12px 16px;background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:15px;outline:none;}"));
        webClient.println(F(".form-group input:focus,.form-group select:focus{border-color:var(--primary);}.btn-submit{width:100%;padding:14px;background:var(--primary);border:none;border-radius:8px;color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:all 0.2s;}"));
        webClient.println(F(".btn-submit:hover{background:var(--primary-hover);}.footer{text-align:center;margin-top:25px;font-size:12px;color:var(--text-muted);}</style></head>"));
        webClient.println(F("<body><div class=\"container\"><div class=\"header\"><h1>InkFlow R4 Setup</h1><p>Configure wireless networks & InkFlow server</p></div>"));
        
        if (lastConnectionError.length() > 0) {
          webClient.print(F("<div style=\"background:#ef4444;border:1px solid #dc2626;border-radius:8px;padding:12px;margin-bottom:20px;font-size:14px;color:#fff;text-align:left;\">⚠️ "));
          webClient.print(lastConnectionError);
          webClient.println(F("</div>"));
        }
        
        webClient.println(F("<form action=\"/save\" method=\"POST\"><div class=\"form-group\"><label>WiFi SSID</label>"));
        webClient.println(F("<select onchange=\"document.getElementById('manual_ssid').value = this.value;\" style=\"width:100%;padding:12px 16px;background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:15px;outline:none;margin-bottom:10px;\">"));
        webClient.println(F("<option value=\"\">-- Select Scanned Network --</option>"));
        for (int i = 0; i < scannedSSIDCount; i++) {
          webClient.print(F("<option value=\""));
          webClient.print(scannedSSIDs[i]);
          webClient.print(F("\">"));
          webClient.print(scannedSSIDs[i]);
          webClient.println(F("</option>"));
        }
        webClient.println(F("</select>"));
        webClient.println(F("<input type=\"text\" id=\"manual_ssid\" name=\"manual_ssid\" placeholder=\"Or type SSID manually\" required></div>"));
        
        webClient.println(F("<div class=\"form-group\"><label>WiFi Password</label>"));
        webClient.println(F("<input type=\"password\" id=\"wifi_pass\" name=\"password\" placeholder=\"Password\" style=\"margin-bottom:8px;\">"));
        webClient.println(F("<div style=\"display:flex;align-items:center;font-size:13px;color:#94a3b8;cursor:pointer;user-select:none;\">"));
        webClient.println(F("<input type=\"checkbox\" id=\"show_pass\" onclick=\"var p=document.getElementById('wifi_pass');p.type=p.type=='password'?'text':'password';\" style=\"width:auto;margin-right:8px;cursor:pointer;\">"));
        webClient.println(F("<label for=\"show_pass\" style=\"display:inline;text-transform:none;font-weight:normal;margin-bottom:0;cursor:pointer;\">Show Password</label>"));
        webClient.println(F("</div></div>"));
        
        webClient.println(F("<div class=\"form-group\"><label>InkFlow Server Host / IP</label><input type=\"text\" name=\"server\" value=\"inkflow.local\" placeholder=\"e.g. inkflow.local or IP address\" required></div>"));
        webClient.println(F("<div class=\"form-group\"><label>Port Bind</label><input type=\"number\" name=\"port\" value=\"5000\" required></div>"));
        webClient.println(F("<div class=\"form-group\"><label>Device custom name</label><input type=\"text\" name=\"devicename\" value=\"Living Room R4 Panel\"></div>"));
        webClient.println(F("<button type=\"submit\" class=\"btn-submit\">Save Settings & Connect</button></form>"));
        
        byte mac[6];
        WiFi.macAddress(mac);
        char macStr[18];
        snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
        webClient.print(F("<div class=\"footer\">Device MAC Address: "));
        webClient.print(macStr);
        webClient.println(F("</div></div></body></html>"));
        
        delay(50); 
        webClient.stop();
      } else {
        Serial.print(F("[Web Server] Redirecting captive probe path: "));
        Serial.print(reqPath);
        Serial.println(F(" to http://192.168.4.1/"));
        
        webClient.println(F("HTTP/1.1 302 Found"));
        webClient.println(F("Location: http://192.168.4.1/"));
        webClient.println(F("Content-Length: 0"));
        webClient.println(F("Connection: close"));
        webClient.println();
        
        delay(50); 
        webClient.stop();
      }
    }
    delay(2);
  }
}

inline bool connectWiFi() {
  Serial.print(F("Attempting to connect to SSID Network: "));
  Serial.println(activeConfig.wifi_ssid);
  
  if (activeConfig.show_connecting == 1) {
    drawConnectingSplashDirect(activeConfig.wifi_ssid, activeConfig.server_host, activeConfig.server_port);
    activeConfig.show_connecting = 0;
    EEPROM.put(0, activeConfig);
  }
  
  if (WiFi.status() == WL_NO_SHIELD) {
    Serial.println(F("[Error] WiFi communication chip missing."));
    drawErrorSplashDirect("WiFi Shield Missing", "UNO R4 WiFi coprocessor", "failed to initialize!");
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
    lastConnectionError = "Failed to connect to network '" + String(activeConfig.wifi_ssid) + "'. Check password and signal strength.";
    drawErrorSplashDirect("WiFi Connection Failed", "SSID: " + String(activeConfig.wifi_ssid), "Check network or credentials!");
    delay(5000); 
    startSetupWizard(); 
    return false;
  }
}

#endif // PORTAL_SERVER_H
