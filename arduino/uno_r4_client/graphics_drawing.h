/*
  graphics_drawing.h - EPD splash screens and diagnostics overlay drawing for Arduino UNO R4 Client
*/

#ifndef GRAPHICS_DRAWING_H
#define GRAPHICS_DRAWING_H

#include <Arduino.h>
#include <WiFiS3.h>
#include "config.h"
#include "config_manager.h"
#include "font8x8.h"
#include "logo.h"
#include "qr_codes.h"

extern Epd epd;

// Forward declaration of EPD wait busy matching config.h macro definitions
#if defined(SCREEN_TYPE_4_26) || defined(SCREEN_TYPE_4_20) || defined(SCREEN_TYPE_2_90)
  #define EPD_WAIT_BUSY_LOCAL(epdInstance) (epdInstance).ReadBusy()
#elif defined(SCREEN_TYPE_7_50)
  #define EPD_WAIT_BUSY_LOCAL(epdInstance) (epdInstance).WaitUntilIdle()
#endif

// Direct-SPI Splash screen renderer utilizing zero-RAM buffering (reads font on-the-fly)
inline void drawSplashDirect(int mode, String param1 = "", String param2 = "", String param3 = "") {
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

  char line1[65] = {0};
  char line2[65] = {0};
  char line3[65] = {0};

  TextElement elements[20];
  int numElements = 0;

  if (mode == 0) {
    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow R4 Setup Portal (Step 1/2)", 40, 30, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 60, 1};
      elements[numElements++] = {"1. Connect your phone or PC to the setup WiFi network:", 40, 110, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 80, 140, 2};
      elements[numElements++] = {"Password: 12345678", 80, 175, 2};
      elements[numElements++] = {"(Or scan the WiFi QR code on the right to connect)", 80, 215, 1};
      
      elements[numElements++] = {"2. Once connected, this screen will automatically refresh", 40, 255, 1};
      elements[numElements++] = {"   and display the setup portal link and QR code.", 40, 275, 1};

      // Draw Connection Error Banner if SSID connection failed
      if (param1 != "") {
        elements[numElements++] = {"WARNING: Connection failed. Check credentials in portal.", 40, 315, 1};
      }
      
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};

      // Add QR Code Caption on the right
      elements[numElements++] = {"Scan to Connect", 615, 305, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"InkFlow R4 Setup (1/2)", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {"1. Connect phone/PC to WiFi:", 20, 80, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 40, 110, 2};
      elements[numElements++] = {"Password: 12345678", 40, 140, 1};
      elements[numElements++] = {"Screen will refresh upon connection...", 20, 180, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"InkFlow R4 Setup (1/2)", 10, 10, 1};
      elements[numElements++] = {"SSID: InkFlow-R4-Setup", 10, 35, 1};
      elements[numElements++] = {"Password: 12345678", 10, 50, 1};
      elements[numElements++] = {"Waiting for connection...", 10, 75, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  } else if (mode == 5) {
    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow R4 Setup Portal (Step 2/2)", 40, 30, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 60, 1};
      elements[numElements++] = {"SSID CONNECTED SUCCESSFULLY!", 40, 110, 2};
      elements[numElements++] = {"Open the setup web page to configure your dashboard:", 40, 150, 1};
      elements[numElements++] = {"Go to: http://192.168.4.1", 80, 180, 2};
      elements[numElements++] = {"(Or scan the URL QR code on the right)", 80, 215, 1};
      
      elements[numElements++] = {"Select your home WiFi network, enter password, and set", 40, 255, 1};
      elements[numElements++] = {"the InkFlow server IP and port. The panel will then reboot.", 40, 275, 1};
      
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};

      // Add QR Code Caption on the right
      elements[numElements++] = {"Scan to Open Portal", 595, 305, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"InkFlow R4 Setup (2/2)", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {"SSID CONNECTED!", 20, 80, 2};
      elements[numElements++] = {"2. Open browser and visit:", 20, 120, 1};
      elements[numElements++] = {"http://192.168.4.1", 40, 145, 2};
      elements[numElements++] = {"Configure WiFi & Server IP details.", 20, 190, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"InkFlow R4 Setup (2/2)", 10, 10, 1};
      elements[numElements++] = {"SSID CONNECTED!", 10, 35, 1};
      elements[numElements++] = {"Visit: http://192.168.4.1", 10, 60, 1};
      elements[numElements++] = {"Submit WiFi/Server details!", 10, 85, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  } else if (mode == 1) {
    snprintf(line1, sizeof(line1), "SSID: %s", param1.c_str());
    snprintf(line2, sizeof(line2), "Host: %s", param2.c_str());
    snprintf(line3, sizeof(line3), "Port: %s", param3.c_str());

    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow Dashboard Connecting...", 40, 40, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 70, 1};
      elements[numElements++] = {"Attempting to connect to WiFi & InkFlow server...", 40, 110, 1};
      elements[numElements++] = {line1, 60, 150, 1};
      elements[numElements++] = {line2, 60, 180, 1};
      elements[numElements++] = {line3, 60, 210, 1};
      elements[numElements++] = {"Please wait, the screen will refresh once connected.", 40, 260, 1};
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"Connecting...", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {line1, 20, 80, 1};
      elements[numElements++] = {line2, 20, 110, 1};
      elements[numElements++] = {line3, 20, 140, 1};
      elements[numElements++] = {"Refreshing shortly...", 20, 180, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"Connecting...", 10, 10, 1};
      elements[numElements++] = {line1, 10, 35, 1};
      elements[numElements++] = {line2, 10, 60, 1};
      elements[numElements++] = {line3, 10, 85, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  } else if (mode == 2) {
    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow Setup Wizard", 40, 40, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 70, 1};
      elements[numElements++] = {"Scanning for local WiFi SSIDs...", 40, 130, 2};
      elements[numElements++] = {"Please wait, searching for available networks...", 40, 180, 1};
      elements[numElements++] = {"This will take a few seconds.", 40, 210, 1};
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"WiFi Scan", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {"Scanning local SSIDs...", 20, 80, 2};
      elements[numElements++] = {"Please wait a moment...", 20, 120, 1};
      elements[numElements++] = {"Starting setup portal...", 20, 150, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"WiFi Scan...", 10, 10, 1};
      elements[numElements++] = {"Scanning local SSIDs", 10, 35, 1};
      elements[numElements++] = {"Please wait...", 10, 55, 1};
      elements[numElements++] = {"Launching portal...", 10, 75, 1};
      elements[numElements++] = {macLine, 10, 110, 1};
    }
  } else if (mode == 3) {
    snprintf(line1, sizeof(line1), "%s", param1.c_str());
    snprintf(line2, sizeof(line2), "%s", param2.c_str());
    snprintf(line3, sizeof(line3), "%s", param3.c_str());

    if (displayWidth >= 800) {
      elements[numElements++] = {"InkFlow Connection Error", 40, 40, 2};
      elements[numElements++] = {"--------------------------------------------------------", 40, 70, 1};
      elements[numElements++] = {"DIAGNOSTICS:", 40, 110, 2};
      elements[numElements++] = {line1, 40, 150, 1};
      elements[numElements++] = {line2, 40, 180, 1};
      elements[numElements++] = {line3, 40, 210, 1};
      elements[numElements++] = {"Check network settings or launch Serial Monitor.", 40, 260, 1};
      elements[numElements++] = {"--------------------------------------------------------", 40, 390, 1};
      elements[numElements++] = {macLine, 40, 420, 1};
    } else if (displayWidth >= 400) {
      elements[numElements++] = {"Error!", 20, 20, 2};
      elements[numElements++] = {"----------------------------------------", 20, 45, 1};
      elements[numElements++] = {line1, 20, 80, 1};
      elements[numElements++] = {line2, 20, 110, 1};
      elements[numElements++] = {line3, 20, 140, 1};
      elements[numElements++] = {"Check configurations.", 20, 180, 1};
      elements[numElements++] = {"----------------------------------------", 20, 230, 1};
      elements[numElements++] = {macLine, 20, 260, 1};
    } else { // 296x128
      elements[numElements++] = {"Error Occurred!", 10, 10, 1};
      elements[numElements++] = {line1, 10, 35, 1};
      elements[numElements++] = {line2, 10, 55, 1};
      elements[numElements++] = {line3, 10, 75, 1};
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

        // 1. Draw borders
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

        // 2. Render Text
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
                uint8_t fontByte = font8x8_basic[(uint8_t)c][fontRow];

                if ((fontByte >> fontCol) & 1) {
                  isBlack = true;
                }
              }
            }
          }
        }

        // 3. Render Logo/QR
        if (!isBlack) {
          if (displayWidth >= 800) {
            if (mode == 0 || mode == 5) {
              int qrX = 620;
              int qrY = 185;
              int qrWidth = 110;
              int qrHeight = 110;
              
              if (x >= qrX && x < qrX + qrWidth && y >= qrY && y < qrY + qrHeight) {
                int lx = x - qrX;
                int ly = y - qrY;
                int byteIdx = ly * 14 + (lx / 8);
                int bitIdx = 7 - (lx % 8);
                uint8_t byteVal = (mode == 0) ? qr_wifi_110x110[byteIdx] : qr_url_110x110[byteIdx];
                if (((byteVal >> bitIdx) & 1) == 0) {
                  isBlack = true;
                }
              }
            } else {
              int logoX = 580;
              int logoY = 120;
              int logoWidth = 160;
              int logoHeight = 160;
              if (x >= logoX && x < logoX + logoWidth && y >= logoY && y < logoY + logoHeight) {
                int lx = x - logoX;
                int ly = y - logoY;
                int byteIdx = (ly * logoWidth + lx) / 8;
                int bitIdx = 7 - ((ly * logoWidth + lx) % 8);
                uint8_t byteVal = logo_160x160[byteIdx];
                if (((byteVal >> bitIdx) & 1) == 0) {
                  isBlack = true;
                }
              }
            }
          } else if (displayWidth >= 400) {
            int logoX = 280;
            int logoY = 80;
            int logoWidth = 80;
            int logoHeight = 80;
            if (x >= logoX && x < logoX + logoWidth && y >= logoY && y < logoY + logoHeight) {
              int lx = x - logoX;
              int ly = y - logoY;
              int byteIdx = (ly * logoWidth + lx) / 8;
              int bitIdx = 7 - ((ly * logoWidth + lx) % 8);
              uint8_t byteVal = logo_80x80[byteIdx];
              if (((byteVal >> bitIdx) & 1) == 0) {
                isBlack = true;
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

  // Trigger EPD hardware refresh
  Serial.println(F("[Display] Triggering global hardware refresh transitions..."));
  epd.SendCommand(0x22); 
  epd.SendData(0xF7); 
  epd.SendCommand(0x20); 
  EPD_WAIT_BUSY_LOCAL(epd);
  
  delay(2000);
  epd.Sleep();
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
  
  String line1, line2;
  
  if (WiFi.status() == WL_CONNECTED) {
    char localIPStr[16];
    IPAddress ip = WiFi.localIP();
    snprintf(localIPStr, sizeof(localIPStr), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
    long rssi = WiFi.RSSI();
    line1 = "SSID: " + String(activeConfig.wifi_ssid) + " (" + String(rssi) + " dBm)";
    line2 = "IP: " + String(localIPStr);
  } else {
    line1 = "SSID: " + String(activeConfig.wifi_ssid) + " (Offline)";
    line2 = "IP: Disconnected";
  }
  
  RTCTime time;
  if (RTC.getTime(time)) {
    char buf[12];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d", time.getHour(), time.getMinutes(), time.getSeconds());
    line2 += " | Time: " + String(buf);
  }
  
  String line3 = "Server: " + String(activeConfig.server_host) + ":" + String(activeConfig.server_port);
  
  drawErrorSplashDirect(line1, line2, line3);
}

#endif // GRAPHICS_DRAWING_H
