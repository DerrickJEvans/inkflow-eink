/*
  graphics_drawing.h - EPD drawing functions for ESP32 Client using GxEPD2
*/

#ifndef GRAPHICS_DRAWING_H
#define GRAPHICS_DRAWING_H

#include <Arduino.h>
#include <WiFi.h>
#include "config.h"
#include "config_manager.h"
#include "font8x8.h"
#include "logo.h"
#include "qr_codes.h"

// GxEPD2 text character drawer helper
inline void drawCharacter(int startX, int startY, char c, int scale) {
  for (int row = 0; row < 8; row++) {
    uint8_t fontByte = font8x8_basic[(uint8_t)c][row];
    for (int col = 0; col < 8; col++) {
      if ((fontByte >> col) & 1) {
        if (scale == 1) {
          display.drawPixel(startX + col, startY + row, GxEPD_BLACK);
        } else {
          display.fillRect(startX + col * scale, startY + row * scale, scale, scale, GxEPD_BLACK);
        }
      }
    }
  }
}

// GxEPD2 text string drawer helper
inline void drawString(int startX, int startY, const String& text, int scale = 1) {
  int curX = startX;
  for (unsigned int i = 0; i < text.length(); i++) {
    drawCharacter(curX, startY, text.charAt(i), scale);
    curX += 8 * scale;
  }
}

inline void drawSplashDirect(int mode, String param1 = "", String param2 = "", String param3 = "") {
  Serial.println(F("[Display] Drawing splash screen direct..."));
  
  display.init(115200);

  char macStr[18];
  byte mac[6];
  WiFi.macAddress(mac);
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  
  char macLine[40];
  snprintf(macLine, sizeof(macLine), "MAC Address: %s", macStr);

  String line1 = "";
  String line2 = "";
  String line3 = "";

  if (mode == 1) {
    line1 = "SSID: " + param1;
    line2 = "Host: " + param2;
    line3 = "Port: " + param3;
  } else if (mode == 3) {
    line1 = param1;
    line2 = param2;
    line3 = param3;
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

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    
    // 1. Draw elegant double borders
    display.drawRect(border1, border1, displayWidth - border1 * 2, displayHeight - border1 * 2, GxEPD_BLACK);
    display.drawRect(border2, border2, displayWidth - border2 * 2, displayHeight - border2 * 2, GxEPD_BLACK);
    
    if (mode == 0) {
      if (displayWidth >= 800) {
        drawString(40, 30, "InkFlow E-Ink Setup Portal (Step 1/2)", 2);
        drawString(40, 60, "--------------------------------------------------------", 1);
        drawString(40, 110, "1. Connect your phone or PC to the setup WiFi network:", 1);
        drawString(80, 140, "SSID: InkFlow-Setup", 2);
        drawString(80, 175, "Password: 12345678", 2);
        drawString(80, 215, "(Or scan the WiFi QR code on the right to connect)", 1);
        drawString(40, 255, "2. Once connected, this screen will automatically refresh", 1);
        drawString(40, 275, "   and display the setup portal link and QR code.", 1);
        if (param1 != "") {
          drawString(40, 315, "WARNING: Connection failed. Check credentials in portal.", 1);
        }
        drawString(40, 390, "--------------------------------------------------------", 1);
        drawString(40, 420, macLine, 1);
        drawString(615, 305, "Scan to Connect", 1);
      } else if (displayWidth >= 400) {
        drawString(20, 20, "InkFlow Setup (1/2)", 2);
        drawString(20, 45, "----------------------------------------", 1);
        drawString(20, 80, "1. Connect phone/PC to WiFi:", 1);
        drawString(40, 110, "SSID: InkFlow-Setup", 2);
        drawString(40, 140, "Password: 12345678", 1);
        drawString(20, 180, "Screen will refresh upon connection...", 1);
        drawString(20, 230, "----------------------------------------", 1);
        drawString(20, 260, macLine, 1);
      } else {
        drawString(10, 10, "InkFlow Setup (1/2)", 1);
        drawString(10, 35, "SSID: InkFlow-Setup", 1);
        drawString(10, 50, "Password: 12345678", 1);
        drawString(10, 75, "Waiting for connection...", 1);
        drawString(10, 110, macLine, 1);
      }
    } else if (mode == 5) {
      if (displayWidth >= 800) {
        drawString(40, 30, "InkFlow E-Ink Setup Portal (Step 2/2)", 2);
        drawString(40, 60, "--------------------------------------------------------", 1);
        drawString(40, 110, "SSID CONNECTED SUCCESSFULLY!", 2);
        drawString(40, 150, "Open the setup web page to configure your dashboard:", 1);
        drawString(80, 180, "Go to: http://192.168.4.1", 2);
        drawString(80, 215, "(Or scan the URL QR code on the right)", 1);
        drawString(40, 255, "Select your home WiFi network, enter password, and set", 1);
        drawString(40, 275, "the InkFlow server IP and port. The panel will then reboot.", 1);
        drawString(40, 390, "--------------------------------------------------------", 1);
        drawString(40, 420, macLine, 1);
        drawString(595, 305, "Scan to Open Portal", 1);
      } else if (displayWidth >= 400) {
        drawString(20, 20, "InkFlow Setup (2/2)", 2);
        drawString(20, 45, "----------------------------------------", 1);
        drawString(20, 80, "SSID CONNECTED!", 2);
        drawString(20, 120, "2. Open browser and visit:", 1);
        drawString(40, 145, "http://192.168.4.1", 2);
        drawString(20, 190, "Configure WiFi & Server IP details.", 1);
        drawString(20, 230, "----------------------------------------", 1);
        drawString(20, 260, macLine, 1);
      } else {
        drawString(10, 10, "InkFlow Setup (2/2)", 1);
        drawString(10, 35, "SSID CONNECTED!", 1);
        drawString(10, 60, "Visit: http://192.168.4.1", 1);
        drawString(10, 85, "Submit WiFi/Server details!", 1);
        drawString(10, 110, macLine, 1);
      }
    } else if (mode == 1) {
      if (displayWidth >= 800) {
        drawString(40, 40, "InkFlow Dashboard Connecting...", 2);
        drawString(40, 70, "--------------------------------------------------------", 1);
        drawString(40, 110, "Attempting to connect to WiFi & InkFlow server...", 1);
        drawString(60, 150, line1, 1);
        drawString(60, 180, line2, 1);
        drawString(60, 210, line3, 1);
        drawString(40, 260, "Please wait, the screen will refresh once connected.", 1);
        drawString(40, 390, "--------------------------------------------------------", 1);
        drawString(40, 420, macLine, 1);
      } else if (displayWidth >= 400) {
        drawString(20, 20, "Connecting...", 2);
        drawString(20, 45, "----------------------------------------", 1);
        drawString(20, 80, line1, 1);
        drawString(20, 110, line2, 1);
        drawString(20, 140, line3, 1);
        drawString(20, 180, "Refreshing shortly...", 1);
        drawString(20, 230, "----------------------------------------", 1);
        drawString(20, 260, macLine, 1);
      } else {
        drawString(10, 10, "Connecting...", 1);
        drawString(10, 35, line1, 1);
        drawString(10, 60, line2, 1);
        drawString(10, 85, line3, 1);
        drawString(10, 110, macLine, 1);
      }
    } else if (mode == 2) {
      if (displayWidth >= 800) {
        drawString(40, 40, "InkFlow Setup Wizard", 2);
        drawString(40, 70, "--------------------------------------------------------", 1);
        drawString(40, 130, "Scanning for local WiFi SSIDs...", 2);
        drawString(40, 180, "Please wait, searching for available networks...", 1);
        drawString(40, 210, "This will take a few seconds.", 1);
        drawString(40, 390, "--------------------------------------------------------", 1);
        drawString(40, 420, macLine, 1);
      } else if (displayWidth >= 400) {
        drawString(20, 20, "WiFi Scan", 2);
        drawString(20, 45, "----------------------------------------", 1);
        drawString(20, 80, "Scanning local SSIDs...", 2);
        drawString(20, 120, "Please wait a moment...", 1);
        drawString(20, 150, "Starting setup portal...", 1);
        drawString(20, 230, "----------------------------------------", 1);
        drawString(20, 260, macLine, 1);
      } else {
        drawString(10, 10, "WiFi Scan...", 1);
        drawString(10, 35, "Scanning local SSIDs", 1);
        drawString(10, 55, "Please wait...", 1);
        drawString(10, 75, "Launching portal...", 1);
        drawString(10, 110, macLine, 1);
      }
    } else if (mode == 3) {
      if (displayWidth >= 800) {
        drawString(40, 40, "InkFlow Connection Error", 2);
        drawString(40, 70, "--------------------------------------------------------", 1);
        drawString(40, 110, "DIAGNOSTICS:", 2);
        drawString(40, 150, line1, 1);
        drawString(40, 180, line2, 1);
        drawString(40, 210, line3, 1);
        drawString(40, 260, "Check network settings or launch Serial Monitor.", 1);
        drawString(40, 390, "--------------------------------------------------------", 1);
        drawString(40, 420, macLine, 1);
      } else if (displayWidth >= 400) {
        drawString(20, 20, "Error!", 2);
        drawString(20, 45, "----------------------------------------", 1);
        drawString(20, 80, line1, 1);
        drawString(20, 110, line2, 1);
        drawString(20, 140, line3, 1);
        drawString(20, 180, "Check configurations.", 1);
        drawString(20, 230, "----------------------------------------", 1);
        drawString(20, 260, macLine, 1);
      } else {
        drawString(10, 10, "Error Occurred!", 1);
        drawString(10, 35, line1, 1);
        drawString(10, 55, line2, 1);
        drawString(10, 75, line3, 1);
        drawString(10, 110, macLine, 1);
      }
    }

    // 2. Draw Logo/QR bitmaps using drawBitmap
    if (displayWidth >= 800) {
      if (mode == 0 || mode == 5) {
        const uint8_t* qrVal = (mode == 0) ? qr_wifi_110x110 : qr_url_110x110;
        display.drawBitmap(620, 185, qrVal, 110, 110, GxEPD_BLACK, GxEPD_WHITE);
      } else {
        display.drawBitmap(580, 120, logo_160x160, 160, 160, GxEPD_BLACK, GxEPD_WHITE);
      }
    } else if (displayWidth >= 400) {
      display.drawBitmap(280, 80, logo_80x80, 80, 80, GxEPD_BLACK, GxEPD_WHITE);
    }

  } while (display.nextPage());

  display.powerOff();
  Serial.println(F("[Display] Splash drawn successfully."));
}

inline void drawSetupSplashDirect(String errorMsg) {
  drawSplashDirect(0, errorMsg);
}

inline void drawPortalSplashDirect() {
  drawSplashDirect(5);
}

inline void drawConnectingSplashDirect(String ssid, String host, int port) {
  drawSplashDirect(1, ssid, host, String(port));
}

inline void drawScanSplashDirect() {
  drawSplashDirect(2);
}

inline void drawErrorSplashDirect(String errorMsg, String detail1, String detail2) {
  drawSplashDirect(3, errorMsg, detail1, detail2);
}

inline void showDiagnostics() {
  Serial.println(F("[Diagnostics] Displaying system diagnostics overlay..."));
  
  char localIPStr[16];
  IPAddress ip = WiFi.localIP();
  snprintf(localIPStr, sizeof(localIPStr), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
  
  long rssi = WiFi.RSSI();
  
  String line1 = "SSID: " + String(activeConfig.wifi_ssid) + " (" + String(rssi) + " dBm)";
  String line2 = "IP: " + String(localIPStr);
  String line3 = "Server: " + String(activeConfig.server_host) + ":" + String(activeConfig.server_port);
  
  drawErrorSplashDirect(line1, line2, line3);
}

#endif // GRAPHICS_DRAWING_H
