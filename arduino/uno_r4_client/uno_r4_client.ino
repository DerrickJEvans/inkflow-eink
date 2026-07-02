/*
  uno_r4_client.ino
  E-Paper Dashboard Client — Arduino UNO R4 WiFi + Waveshare e-Paper Shield (B)

  Architecture: Low-RAM Direct SPI Streaming & EEPROM Wifi Wizard
  ──────────────────────────────────────────────────────────────────
  Bypasses GxEPD2 buffer allocations to stream HTTP raw 1-bit monochrome E-Ink
  data straight to the screen controller over SPI, fitting Large screens into 32KB RAM.
  Features a built-in Setup Web AP Portal and EEPROM storage to easily configure
  WiFi networks and server hosts dynamically without code changes.
*/

#include <SPI.h>
#include <RTC.h>
#include <WiFiS3.h>
#include <WiFiUdp.h>
#include <EEPROM.h>
#include "config.h"
#include "logo.h"
#include "qr_codes.h"
#include "cache_manager.h"
#include "config_manager.h"
#include "system_utils.h"
#include "graphics_drawing.h"
#include "portal_server.h"

// Global hardware interfaces
Epd epd;
WiFiClient client;
WiFiServer server(80); 
WiFiUDP dnsUDP;
const byte DNS_PORT = 53;

// Global settings
EEPROMConfig activeConfig;
extern const uint32_t CONFIG_MAGIC = 0xDEFAEC20;
int nextRefreshSeconds = fallbackSleepSeconds;
String lastConnectionError = "";

// Wakeup action storage indexes (battery backup registers)
extern const int VBTBKR_ACTION_INDEX = 16;
extern const int VBTBKR_MAGIC_INDEX  = 17;
extern const uint8_t VBTBKR_MAGIC_VAL = 0xAB;

// Caching parameters
FlashCache cache(FLASH_CS);
int currentCacheSlot = -1; 
bool cacheEnabled = false; 
const uint32_t totalImageBytes = (displayWidth * displayHeight) / 2; // 192KB for 4-gray (4bpp)
const uint32_t monoImageBytes  = (displayWidth * displayHeight) / 8; // 48KB for 1-bit 

// WiFi options
String scannedSSIDs[20];
int scannedSSIDCount = 0;

// Forward declarations of streaming/cache functions
bool fetchAndStreamDisplay(String action = "");
void displayCachedImage(int slotIndex);
void loadOfflineCache();
void syncRTCTime(String dateStr);
uint8_t unpackRAM1(uint8_t b0, uint8_t b1, uint8_t b2, uint8_t b3);
uint8_t unpackRAM2(uint8_t b0, uint8_t b1, uint8_t b2, uint8_t b3);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n--- InkFlow Arduino R4 WiFi Client (Direct Stream) ---"));

  // Initialize physical button pins
  pinMode(PIN_PREV, INPUT_PULLUP);
  pinMode(PIN_NEXT, INPUT_PULLUP);
  pinMode(PIN_DIAG, INPUT_PULLUP);
  pinMode(PIN_AP,   INPUT_PULLUP);

  // Initialize RTC
  RTC.begin();
  RTCTime currentTime;
  if (!RTC.getTime(currentTime) || currentTime.getYear() < 2026) {
    Serial.println(F("[RTC] RTC time invalid or uninitialized. Setting to default..."));
    RTCTime defaultTime(25, Month::JUNE, 2026, 12, 0, 0, DayOfWeek::THURSDAY, SaveLight::SAVING_TIME_INACTIVE);
    RTC.setTime(defaultTime);
  }

  // Lock out unused peripheral selectors on the shield to prevent SPI cross-talk noise
  pinMode(RAM_CS,   OUTPUT); digitalWrite(RAM_CS,   HIGH);
  pinMode(FLASH_CS, OUTPUT); digitalWrite(FLASH_CS, HIGH);
  pinMode(EPD_CS,   OUTPUT); digitalWrite(EPD_CS,   HIGH);

  // Initialize SPI bus interface
  SPI.begin();

  // Initialize SPI Flash Cache
  cache.begin();

  // Perform SPI Flash Self-Test
  Serial.println(F("[Cache] Running SPI Flash Self-Test..."));
  uint8_t testWrite[4] = {0xDE, 0xAD, 0xBE, 0xEF};
  uint8_t testRead[4] = {0, 0, 0, 0};
  cache.writeData(0x1000, testWrite, 4);
  cache.readData(0x1000, testRead, 4);
  Serial.print(F("[Cache] Self-Test Read: "));
  for (int i = 0; i < 4; i++) {
    Serial.print(testRead[i], HEX);
    Serial.print(" ");
  }
  Serial.println();
  if (testRead[0] == 0xDE && testRead[1] == 0xAD && testRead[2] == 0xBE && testRead[3] == 0xEF) {
    Serial.println(F("[Cache] Self-Test PASSED!"));
    cacheEnabled = true;
  } else {
    Serial.println(F("[Cache] Self-Test FAILED! Caching disabled."));
    cacheEnabled = false;
  }

  // Load configuration from EEPROM
  loadConfiguration();

  // Read button states (woken by button press or checked on startup)
  delay(100); // Debounce

  // 1. Check if we woke up from a button captured in battery backup registers
  int actionCode = 0; // 0: none/timer, 1: prev, 2: next, 3: diag, 4: ap
  if (R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] == VBTBKR_MAGIC_VAL) {
    actionCode = R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX];
    
    // Clear magic immediately to prevent re-processing on subsequent resets
    R_SYSTEM->PRCR = 0xA502;
    R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = 0x00;
    R_SYSTEM->PRCR = 0xA500;
    
    Serial.print(F("[Power] Wakeup action code from VBTBKR: "));
    Serial.println(actionCode);
  }

  // 2. Fallback to reading pins directly (only trust actionCode for shared pins D2/D3 to avoid stuck LOW logic)
  bool prevPressed = (actionCode == 1);
  bool nextPressed = (actionCode == 2);
  bool diagPressed = (actionCode == 3) || (digitalRead(PIN_DIAG) == LOW);
  bool apPressed   = (actionCode == 4) || (digitalRead(PIN_AP) == LOW);

  if (apPressed) {
    Serial.println(F("[Buttons] AP Button (Button 4) pressed. Restarting Arduino..."));
    delay(500);
    NVIC_SystemReset();
  }

  // Initialize WiFi connection
  if (strlen(activeConfig.wifi_ssid) == 0 || strcmp(activeConfig.wifi_ssid, "YOUR_WIFI_SSID") == 0) {
    Serial.println(F("[Config] WiFi SSID unconfigured. Launching Setup Wizard AP..."));
    startSetupWizard(); // Enters endless loop
  }

  if (diagPressed) {
    Serial.println(F("[Buttons] Diagnostics Button pressed. Checking hold duration..."));
    
    // Hold PIN_DIAG for 3 seconds to trigger captive portal setup
    unsigned long diagCheckStart = millis();
    bool held = true;
    while (millis() - diagCheckStart < 3000) {
      if (digitalRead(PIN_DIAG) == HIGH) {
        held = false;
        break;
      }
      delay(50);
    }
    
    if (held) {
      Serial.println(F("[Config] Diagnostics Button held for 3s. Wiping settings and launching Setup AP..."));
      activeConfig.magic = 0;
      EEPROM.put(0, activeConfig);
      startSetupWizard(); // Enters endless loop
    } else {
      Serial.println(F("[Buttons] Short press detected. Showing diagnostics report..."));
      connectWiFiSilent(); // Attempt a silent connection to populate IP and RSSI if available
      showDiagnostics();   // Show diagnostics overlay regardless of connection success
      Serial.println(F("[Diagnostics] Diagnostics displayed. Entering sleep in 10 seconds..."));
      delay(10000); // Show diagnostics for 10 seconds before sleeping
      goToSleep(nextRefreshSeconds);
    }
  }

  // Determine action (prev, next, or standard sync)
  String action = "";
  if (prevPressed) {
    action = "prev";
  } else if (nextPressed) {
    action = "next";
  }

  // Connect and sync
  if (connectWiFi()) {
    if (fetchAndStreamDisplay(action)) {
      Serial.println(F("[Success] Display synced successfully."));
    } else {
      Serial.println(F("[Warning] Direct stream failed. Checking cache..."));
      loadOfflineCache();
    }
  } else {
    Serial.println(F("[Warning] WiFi connection failed. Checking cache..."));
    loadOfflineCache();
  }

  // Enter standby sleep mode
  goToSleep(nextRefreshSeconds);
}

void loop() {
  // Loop is unused as UNO R4 WiFi wakes from Software Standby, runs setup(), and enters standby again.
}

void loadOfflineCache() {
  CacheHeader header;
  if (cacheEnabled && cache.getHeader(header) && header.total_slots > 0) {
    Serial.println(F("[Cache] Loading Offline Cache Slot 0..."));
    currentCacheSlot = 0;
    displayCachedImage(0);
  } else {
    Serial.println(F("[Cache Error] No offline cache found or cache is disabled."));
    drawErrorSplashDirect("Offline & No Cache", "Please connect to WiFi", "to download images.");
  }
}

void displayCachedImage(int slotIndex) {
  Serial.print(F("[Display] Displaying cached image from Slot "));
  Serial.println(slotIndex);

  // Initialize display CS lines
  pinMode(RAM_CS, OUTPUT); digitalWrite(RAM_CS, HIGH); // Disable Flash SPI CS first
  
  if (epd.Init_4GRAY() != 0) {
     Serial.println(F("[Error] E-Paper init failed during cache read."));
     return;
  }

  uint32_t startAddr = CACHE_SLOTS_START_ADDR + ((uint32_t)slotIndex * SLOT_SPACING);
  
  // We allocate a buffer for chunk processing (4800 bytes = 12 E-Paper rows)
  const uint32_t chunkSize = 4800;
  uint8_t* tempBuf = (uint8_t*)malloc(chunkSize);
  if (!tempBuf) {
    Serial.println(F("[Error] Failed to allocate temporary buffer for EPD transfer."));
    return;
  }

  // Pass 1: Send RAM1 (0x24) - Lower Bit in bursts
  Serial.println(F("[Display] Sending RAM1 (0x24) lower bit channel..."));
  for (uint32_t i = 0; i < totalImageBytes; i += chunkSize) {
    cache.readData(startAddr + i, tempBuf, chunkSize);
    
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    if (i == 0) {
      digitalWrite(CS_PIN, LOW);
      digitalWrite(DC_PIN, LOW); // Command mode
      SPI.transfer(0x24);
      digitalWrite(CS_PIN, HIGH);
    }
    
    digitalWrite(CS_PIN, LOW);
    digitalWrite(DC_PIN, HIGH); // Data mode
    for (uint32_t k = 0; k < chunkSize; k += 4) {
      uint8_t unpackedVal = unpackRAM1(tempBuf[k], tempBuf[k+1], tempBuf[k+2], tempBuf[k+3]);
      SPI.transfer(unpackedVal);
    }
    digitalWrite(CS_PIN, HIGH);
    SPI.endTransaction();
  }

  // Pass 2: Send RAM2 (0x26) - Upper Bit in bursts
  Serial.println(F("[Display] Sending RAM2 (0x26) upper bit channel..."));
  for (uint32_t i = 0; i < totalImageBytes; i += chunkSize) {
    cache.readData(startAddr + i, tempBuf, chunkSize);
    
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    if (i == 0) {
      digitalWrite(CS_PIN, LOW);
      digitalWrite(DC_PIN, LOW); // Command mode
      SPI.transfer(0x26);
      digitalWrite(CS_PIN, HIGH);
    }
    
    digitalWrite(CS_PIN, LOW);
    digitalWrite(DC_PIN, HIGH); // Data mode
    for (uint32_t k = 0; k < chunkSize; k += 4) {
      uint8_t unpackedVal = unpackRAM2(tempBuf[k], tempBuf[k+1], tempBuf[k+2], tempBuf[k+3]);
      SPI.transfer(unpackedVal);
    }
    digitalWrite(CS_PIN, HIGH);
    SPI.endTransaction();
  }

  free(tempBuf);

  // Trigger physical EPD 4-gray refresh
  Serial.println(F("[Display] Triggering physical 4-gray screen refresh..."));
  epd.TurnOnDisplay_4GRAY();
  EPD_WAIT_BUSY_LOCAL(epd);
  
  delay(2000);
  epd.Sleep();
  Serial.println(F("[Display] Cache screen update finished."));
}

bool fetchAndStreamDisplay(String action) {
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

  // Send standard HTTP GET request with TRMNL headers
  client.print(F("GET /api/display/raw?device="));
  client.print(macStr);
  client.print(F("&width="));
  client.print(displayWidth);
  client.print(F("&height="));
  client.print(displayHeight);
  if (cacheEnabled) {
    client.print(F("&dither=4gray"));
  }
  if (action.length() > 0) {
    client.print(F("&action="));
    client.print(action);
    client.print(F("&force=true"));
  }
  client.println(F(" HTTP/1.1"));
  client.print(F("Host: "));
  client.println(activeConfig.server_host);
  client.print(F("ID: "));
  client.println(macStr);
  client.print(F("Access-Token: "));
  client.println(macStr); 
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

  Serial.println(F("Parsing HTTP Headers..."));
  String currentLine = "";
  uint8_t headerState = 0;
  bool hasRefreshRateHeader = false;
  bool isFirstLine = true;
  timeout = millis();
  
  String carouselSig = "";
  int serverImageIndex = 0;
  int serverTotalImages = 1;

  while (client.connected() || client.available() > 0) {
    if (client.available() > 0) {
      char c = client.read();
      timeout = millis(); 
      
      if (c != '\r' && c != '\n') {
        currentLine += c;
      }
      
      if (headerState == 0 && c == '\r') headerState = 1;
      else if (headerState == 1 && c == '\n') {
        if (isFirstLine) {
          isFirstLine = false;
          if (currentLine.indexOf(" 200") == -1) {
            Serial.print(F("[Error] Bad HTTP status: "));
            Serial.println(currentLine);
            client.stop();
            return false;
          }
        }

        if (currentLine.length() > 0) {
          Serial.print(F("[HTTP Header] "));
          Serial.println(currentLine);
        }

        String lowerLine = currentLine;
        lowerLine.toLowerCase();

        if (lowerLine.startsWith("x-refresh-rate:")) {
          int colonIdx = lowerLine.indexOf(':');
          if (colonIdx != -1) {
            String valStr = currentLine.substring(colonIdx + 1);
            valStr.trim();
            int parsedRate = valStr.toInt();
            if (parsedRate > 0) {
              nextRefreshSeconds = parsedRate;
              hasRefreshRateHeader = true;
              Serial.print(F("[Header] Server set refresh rate (carousel): "));
              Serial.print(nextRefreshSeconds);
              Serial.println(F(" seconds"));
            }
          }
        } else if (lowerLine.startsWith("x-trmnl-deep-sleep:")) {
          if (!hasRefreshRateHeader) {
            int colonIdx = lowerLine.indexOf(':');
            if (colonIdx != -1) {
              String valStr = currentLine.substring(colonIdx + 1);
              valStr.trim();
              int parsedRate = valStr.toInt();
              if (parsedRate > 0) {
                nextRefreshSeconds = parsedRate;
                Serial.print(F("[Header] Server set refresh rate (fallback): "));
                Serial.print(nextRefreshSeconds);
                Serial.println(F(" seconds"));
              }
            }
          }
        } else if (lowerLine.startsWith("date:")) {
          int colonIdx = lowerLine.indexOf(':');
          if (colonIdx != -1) {
            String dateVal = currentLine.substring(colonIdx + 1);
            dateVal.trim();
            Serial.print(F("[Header] Date matched: "));
            Serial.println(dateVal);
            syncRTCTime(dateVal);
          }
        } else if (lowerLine.startsWith("x-carousel-signature:")) {
          int colonIdx = lowerLine.indexOf(':');
          if (colonIdx != -1) {
            carouselSig = currentLine.substring(colonIdx + 1);
            carouselSig.trim();
            Serial.print(F("[Header] Server Signature matched: "));
            Serial.println(carouselSig);
          }
        } else if (lowerLine.startsWith("x-image-index:")) {
          int colonIdx = lowerLine.indexOf(':');
          if (colonIdx != -1) {
            String val = currentLine.substring(colonIdx + 1);
            val.trim();
            serverImageIndex = val.toInt();
            Serial.print(F("[Header] Server Image Index matched: "));
            Serial.println(serverImageIndex);
          }
        } else if (lowerLine.startsWith("x-total-images:")) {
          int colonIdx = lowerLine.indexOf(':');
          if (colonIdx != -1) {
            String val = currentLine.substring(colonIdx + 1);
            val.trim();
            serverTotalImages = val.toInt();
            Serial.print(F("[Header] Server Total Images matched: "));
            Serial.println(serverTotalImages);
          }
        }
        currentLine = "";
        headerState = 2;
      }
      else if (headerState == 2 && c == '\r') headerState = 3;
      else if (headerState == 3 && c == '\n') {
        Serial.println(F("[Header] Found boundary safely. Switching to Binary Stream."));
        break; 
      }
      else {
        headerState = 0; 
      }
    }
    if (millis() - timeout > 3000) {
      Serial.println(F("[Error] Timeout waiting for header boundary."));
      client.stop();
      return false;
    }
  }

  if (cacheEnabled && carouselSig.length() > 0 && serverImageIndex < MAX_SLOTS) {
    CacheHeader localHeader;
    bool hasHeader = cache.getHeader(localHeader);

    if (!hasHeader || strncmp(localHeader.signature, carouselSig.c_str(), 32) != 0) {
      Serial.println(F("[Cache] Signature mismatch or no cache. Invalidate cache..."));
      cache.initCache(carouselSig, displayWidth, displayHeight);
      hasHeader = cache.getHeader(localHeader); 
    }

    if (hasHeader && serverImageIndex < (int)localHeader.total_slots) {
      Serial.print(F("[Cache] Image is already cached in Slot "));
      Serial.println(serverImageIndex);
      
      client.stop();
      displayCachedImage(serverImageIndex);
      return true;
    }

    Serial.print(F("[Cache] Image not cached. Downloading to RAM Slot "));
    Serial.println(serverImageIndex);

    bool success = cache.writeSlot(serverImageIndex, client, totalImageBytes);
    client.stop();

    if (success) {
      if (serverImageIndex >= (int)localHeader.total_slots) {
        localHeader.total_slots = serverImageIndex + 1;
        cache.saveHeader(localHeader);
      }
      displayCachedImage(serverImageIndex);
      return true;
    } else {
      Serial.println(F("[Cache Error] Failed to write stream to RAM slot."));
      return false;
    }
  }

  Serial.println(F("Initializing E-Paper controller lines (No Cache Fallback)..."));
  if (epd.Init() != 0) {
     Serial.println(F("[Error] Display initialization step failed."));
     client.stop();
     return false;
  }

  epd.SendCommand(0x24);

  uint32_t bytesWritten = 0;
  timeout = millis();

  Serial.println(F("Streaming raw image packets directly to screen RAM..."));
  
  while (bytesWritten < monoImageBytes) {
    if (client.available() > 0) {
      uint8_t incomingByte = client.read();
      epd.SendData(incomingByte);
      bytesWritten++;
      timeout = millis(); 
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

  if (bytesWritten < monoImageBytes) {
    uint32_t missingBytes = monoImageBytes - bytesWritten;
    Serial.print(F("[Padding] Filling remaining "));
    Serial.print(missingBytes);
    Serial.println(F(" bytes with white rows..."));
    
    for (uint32_t p = 0; p < missingBytes; p++) {
      epd.SendData(0xFF); 
    }
    bytesWritten = monoImageBytes;
  }

  Serial.println(F("Triggering global hardware refresh transitions..."));
  epd.SendCommand(0x22); 
  epd.SendData(0xF7); 
  epd.SendCommand(0x20); 
  
  EPD_WAIT_BUSY_LOCAL(epd);
  
  delay(2000);
  epd.Sleep();
  
  return true;
}

void syncRTCTime(String dateStr) {
  // Expected format: "Thu, 02 Jul 2026 11:30:00 GMT" or "02 Jul 2026 11:30:00 GMT"
  // Let's strip the weekday if present
  int commaIdx = dateStr.indexOf(',');
  if (commaIdx != -1) {
    dateStr = dateStr.substring(commaIdx + 1);
    dateStr.trim();
  }
  // Now format should be: "02 Jul 2026 11:30:00 GMT"
  int firstSpace = dateStr.indexOf(' ');
  if (firstSpace == -1) return;
  String dayStr = dateStr.substring(0, firstSpace);
  
  int secondSpace = dateStr.indexOf(' ', firstSpace + 1);
  if (secondSpace == -1) return;
  String monthStr = dateStr.substring(firstSpace + 1, secondSpace);
  
  int thirdSpace = dateStr.indexOf(' ', secondSpace + 1);
  if (thirdSpace == -1) return;
  String yearStr = dateStr.substring(secondSpace + 1, thirdSpace);
  
  int fourthSpace = dateStr.indexOf(' ', thirdSpace + 1);
  String timeStr;
  if (fourthSpace == -1) {
    timeStr = dateStr.substring(thirdSpace + 1);
  } else {
    timeStr = dateStr.substring(thirdSpace + 1, fourthSpace);
  }
  
  int day = dayStr.toInt();
  int year = yearStr.toInt();
  
  Month month = Month::JANUARY;
  monthStr.toLowerCase();
  if (monthStr == "jan") month = Month::JANUARY;
  else if (monthStr == "feb") month = Month::FEBRUARY;
  else if (monthStr == "mar") month = Month::MARCH;
  else if (monthStr == "apr") month = Month::APRIL;
  else if (monthStr == "may") month = Month::MAY;
  else if (monthStr == "jun") month = Month::JUNE;
  else if (monthStr == "jul") month = Month::JULY;
  else if (monthStr == "aug") month = Month::AUGUST;
  else if (monthStr == "sep") month = Month::SEPTEMBER;
  else if (monthStr == "oct") month = Month::OCTOBER;
  else if (monthStr == "nov") month = Month::NOVEMBER;
  else if (monthStr == "dec") month = Month::DECEMBER;
  
  int firstColon = timeStr.indexOf(':');
  if (firstColon == -1) return;
  String hourStr = timeStr.substring(0, firstColon);
  
  int secondColon = timeStr.indexOf(':', firstColon + 1);
  if (secondColon == -1) return;
  String minStr = timeStr.substring(firstColon + 1, secondColon);
  String secStr = timeStr.substring(secondColon + 1);
  
  int hour = hourStr.toInt();
  int minute = minStr.toInt();
  int second = secStr.toInt();
  
  if (year >= 2026 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
    RTCTime newTime(day, month, year, hour, minute, second, DayOfWeek::THURSDAY, SaveLight::SAVING_TIME_INACTIVE);
    RTC.setTime(newTime);
    Serial.print(F("[RTC] Synchronized time successfully to: "));
    Serial.print(day); Serial.print("-"); Serial.print(monthStr); Serial.print("-"); Serial.print(year);
    Serial.print(" "); Serial.print(hour); Serial.print(":"); Serial.print(minute); Serial.print(":"); Serial.println(second);
  }
}

uint8_t unpackRAM1(uint8_t b0, uint8_t b1, uint8_t b2, uint8_t b3) {
  uint8_t p0 = ((b0 >> 4) & 0x02) >> 1;
  uint8_t p1 = (b0 & 0x02) >> 1;
  uint8_t p2 = ((b1 >> 4) & 0x02) >> 1;
  uint8_t p3 = (b1 & 0x02) >> 1;
  uint8_t p4 = ((b2 >> 4) & 0x02) >> 1;
  uint8_t p5 = (b2 & 0x02) >> 1;
  uint8_t p6 = ((b3 >> 4) & 0x02) >> 1;
  uint8_t p7 = (b3 & 0x02) >> 1;
  return (p0 << 7) | (p1 << 6) | (p2 << 5) | (p3 << 4) | (p4 << 3) | (p5 << 2) | (p6 << 1) | p7;
}

uint8_t unpackRAM2(uint8_t b0, uint8_t b1, uint8_t b2, uint8_t b3) {
  uint8_t p0 = (b0 >> 4) & 0x01;
  uint8_t p1 = b0 & 0x01;
  uint8_t p2 = (b1 >> 4) & 0x01;
  uint8_t p3 = b1 & 0x01;
  uint8_t p4 = (b2 >> 4) & 0x01;
  uint8_t p5 = b2 & 0x01;
  uint8_t p6 = (b3 >> 4) & 0x01;
  uint8_t p7 = b3 & 0x01;
  return (p0 << 7) | (p1 << 6) | (p2 << 5) | (p3 << 4) | (p4 << 3) | (p5 << 2) | (p6 << 1) | p7;
}