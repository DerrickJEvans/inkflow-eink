/*
  xiao_eepaper_client.ino - E-Paper Dashboard Client for XIAO ESP32-S3 & Seeed Studio EE04 Board
  
  Architecture: Low-RAM Direct SPI Caching & LittleFS Wifi Wizard
  ──────────────────────────────────────────────────────────────────
  Downloads dithered raw 4-level grayscale (2-bit depth) byte arrays from the InkFlow server,
  caches them locally in ESP32-S3 LittleFS partition blocks for carousel rotation,
  and displays them on the 4.26 inch SSD1677 screen using the Seeed_GFX library.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

#include "driver.h"
#include "config.h"
#include "logo.h"
#include "qr_codes.h"
#include "cache_manager.h"
#include "config_manager.h"
#include "system_utils.h"
#include "graphics_drawing.h"
#include "portal_server.h"

// Global hardware interfaces
WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);

// Instantiate display driver from Seeed_GFX (reads driver.h config internally)
EPaper epaper;

// Global settings
EEPROMConfig activeConfig;
const uint32_t CONFIG_MAGIC = 0xDEFAEC20;
int nextRefreshSeconds = fallbackSleepSeconds;
String lastConnectionError = "";

// Caching parameters
FlashCache cache(0); // Pin parameter ignored in LittleFS
int currentCacheSlot = -1;
bool cacheEnabled = true;
uint8_t* imageBuffer = nullptr;

// WiFi options
String scannedSSIDs[20];
int scannedSSIDCount = 0;

// Forward declarations
bool fetchAndStreamDisplay(String action = "");
void displayCachedImage(int slotIndex);
void loadOfflineCache();
void updateDisplay();

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n--- InkFlow XIAO ESP32-S3 E-Paper Client Awake ---");

  // Configure onboard buttons (KEY0, KEY1, KEY2) as inputs with pull-ups
  pinMode(BTN_KEY0, INPUT_PULLUP);
  pinMode(BTN_KEY1, INPUT_PULLUP);
  pinMode(BTN_KEY2, INPUT_PULLUP);

  // Initialize LittleFS Partition Cache
  if (!cache.begin()) {
    cacheEnabled = false;
    Serial.println(F("[Cache] Offline caching disabled due to mount failure."));
  }

  // Load Preferences configurations
  loadConfiguration();

  // Initialize display driver and set up 4-grayscale mode
  Serial.println("[Display] Initializing Seeed_GFX EPaper driver...");
  epaper.begin();
  epaper.fillScreen(TFT_WHITE); // Fill with White in 1-bit mode
  epaper.update();
  epaper.initGrayMode(GRAY_LEVEL4);

  // Detect Sleep Wakeup Cause and map Button inputs
  String action = "";
  esp_sleep_wakeup_cause_t wakeup_cause = esp_sleep_get_wakeup_cause();
  if (wakeup_cause == ESP_SLEEP_WAKEUP_EXT1) {
    Serial.println(F("[Power] Woken up by physical button press!"));
    uint64_t wakeup_pin_mask = esp_sleep_get_ext1_wakeup_status();
    
    // Check both hardware wakeup status register and live pin state (active low)
    bool key0Pressed = (wakeup_pin_mask & (1ULL << BTN_KEY0)) != 0 || (digitalRead(BTN_KEY0) == LOW);
    bool key1Pressed = (wakeup_pin_mask & (1ULL << BTN_KEY1)) != 0 || (digitalRead(BTN_KEY1) == LOW);
    bool key2Pressed = (wakeup_pin_mask & (1ULL << BTN_KEY2)) != 0 || (digitalRead(BTN_KEY2) == LOW);

    if (key0Pressed) {
      Serial.println(F("[Buttons] KEY0 pressed: Carousel PREV"));
      action = "prev";
    } else if (key1Pressed) {
      Serial.println(F("[Buttons] KEY1 pressed: Carousel NEXT"));
      action = "next";
    } else if (key2Pressed) {
      Serial.println(F("[Buttons] KEY2 pressed: Diagnostics / Setup AP"));
      action = "setup";
    }
  }

  // Handle KEY2 pressed / developer force reset
  if (action == "setup") {
    Serial.println(F("[Diagnostics] KEY2 pressed. Displaying diagnostics overlay..."));
    showDiagnostics();
    
    // Hold KEY2 for 3 seconds to trigger config reset
    unsigned long key2CheckStart = millis();
    bool held = true;
    while (millis() - key2CheckStart < 3000) {
      if (digitalRead(BTN_KEY2) == HIGH) {
        held = false;
        break;
      }
      delay(50);
    }
    
    if (held) {
      Serial.println(F("[Config] KEY2 held for 3s. Wiping settings and launching Setup AP..."));
      Preferences prefs;
      prefs.begin("inkflow", false);
      prefs.clear();
      prefs.end();
      startSetupWizard();
    } else {
      Serial.println(F("[Diagnostics] Diagnostics displayed. Entering deep sleep shortly..."));
      delay(8000);
      goToSleep(fallbackSleepSeconds);
    }
  }


  // Use Seeed GFX internal sprite frame buffer directly
  imageBuffer = (uint8_t*)epaper.getPointer();
  if (imageBuffer == nullptr) {
    Serial.println(F("[Error] Seeed GFX Sprite buffer is null!"));
    goToSleep(fallbackSleepSeconds);
  }

  // Connect to WiFi and Sync
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

  // Enter deep sleep
  goToSleep(nextRefreshSeconds);
}

void loop() {
  // Loop is unused as ESP32-S3 wakes up from deep sleep, runs setup(), and sleeps again.
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

  if (imageBuffer != nullptr && cacheEnabled) {
    if (cache.readSlot(slotIndex, imageBuffer, bufferSize)) {
      updateDisplay();
    } else {
      Serial.println(F("[Cache Error] Failed to read cached slot file."));
    }
  } else {
    Serial.println(F("[Error] Caching disabled or buffer invalid."));
  }
}

void updateDisplay() {
  Serial.println("[Display] Pushing raw dithered horizontal bitmap to epaper...");
  
  // Since imageBuffer points directly to the sprite buffer (epaper.getPointer()),
  // the data is already in place. We just need to trigger the panel refresh!
  epaper.update();
  
  Serial.println("[Display] Screen updated successfully!");
}

bool fetchAndStreamDisplay(String action) {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  HTTPClient http;
  String macAddress = WiFi.macAddress();
  
  char url[256];
  // Append dither=4gray so server renders 4-gray levels and packages into 4bpp (192KB) buffer
  snprintf(url, sizeof(url), "http://%s:%d/api/display/raw?device=%s&width=%d&height=%d&dither=4gray", 
           activeConfig.server_host, activeConfig.server_port, macAddress.c_str(), displayWidth, displayHeight);
           
  if (action.length() > 0) {
    String tempUrl = String(url) + "&action=" + action + "&force=true";
    strncpy(url, tempUrl.c_str(), sizeof(url) - 1);
  }
  
  Serial.printf("[HTTP] Fetching raw stream: %s\n", url);
  http.begin(url);
  
  const char* collectHeaders[] = {"X-Refresh-Rate", "X-Carousel-Signature", "X-Image-Index", "X-Total-Images"};
  http.collectHeaders(collectHeaders, 4);
 
  http.addHeader("ID", macAddress);
  http.addHeader("Access-Token", macAddress);
  http.addHeader("Device-Name", activeConfig.device_name);
  http.addHeader("FW-Version", "InkFlow-XIAO-v1.0.0");
  http.addHeader("RSSI", String(WiFi.RSSI()));
  http.addHeader("Battery-Voltage", "USB");
  http.addHeader("Connection", "close");

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[HTTP] GET failed, server response code: %d\n", httpCode);
    http.end();
    return false;
  }
  
  int len = http.getSize();
  
  // Parse Custom Headers
  if (http.hasHeader("X-Refresh-Rate")) {
    int rate = http.header("X-Refresh-Rate").toInt();
    if (rate > 0) {
      nextRefreshSeconds = rate;
      Serial.printf("[Header] Server set refresh rate: %d seconds\n", nextRefreshSeconds);
    }
  }
  
  String carouselSig = "";
  if (http.hasHeader("X-Carousel-Signature")) {
    carouselSig = http.header("X-Carousel-Signature");
    carouselSig.trim();
  }
  
  int serverImageIndex = 0;
  if (http.hasHeader("X-Image-Index")) {
    serverImageIndex = http.header("X-Image-Index").toInt();
  }
  
  int serverTotalImages = 1;
  if (http.hasHeader("X-Total-Images")) {
    serverTotalImages = http.header("X-Total-Images").toInt();
  }
  
  WiFiClient* stream = http.getStreamPtr();
  
  bool useCache = false;
  if (carouselSig.length() > 0 && serverImageIndex < MAX_SLOTS) {
    CacheHeader localHeader;
    bool hasHeader = cache.getHeader(localHeader);
    
    if (!hasHeader || strncmp(localHeader.signature, carouselSig.c_str(), 32) != 0) {
      Serial.println(F("[Cache] Signature mismatch or no cache. Invalidate LittleFS cache..."));
      cache.initCache(carouselSig, displayWidth, displayHeight);
      hasHeader = cache.getHeader(localHeader);
    }
    
    if (hasHeader && serverImageIndex < (int)localHeader.total_slots && cache.hasSlot(serverImageIndex, bufferSize)) {
      Serial.printf("[Cache] Slide %d already cached. Displaying...\n", serverImageIndex);
      http.end();
      displayCachedImage(serverImageIndex);
      return true;
    }
    useCache = true;
  }
  
  // Download stream into RAM (sprite) buffer
  if (imageBuffer == nullptr) {
    imageBuffer = (uint8_t*)epaper.getPointer();
  }
  
  if (imageBuffer == nullptr) {
    Serial.println(F("[Error] Seeed GFX Sprite buffer is null!"));
    http.end();
    return false;
  }
  
  int bytesRead = 0;
  unsigned long timeout = millis();
  
  while (http.connected() && bytesRead < bufferSize) {
    size_t sizeAvail = stream->available();
    if (sizeAvail > 0) {
      int readLen = min((int)sizeAvail, bufferSize - bytesRead);
      int c = stream->readBytes(imageBuffer + bytesRead, readLen);
      bytesRead += c;
      timeout = millis();
    } else if (millis() - timeout > 4000) {
      Serial.println(F("[Error] Stream timed out mid-frame."));
      break;
    }
    delay(1);
  }
  
  http.end();
  Serial.printf("[HTTP] Downloaded %d bytes of raw screen pixel buffer.\n", bytesRead);
  
  if (bytesRead < bufferSize) {
    // 0x33 corresponds to light gray / white pattern for filling remaining bytes
    memset(imageBuffer + bytesRead, 0x33, bufferSize - bytesRead);
    bytesRead = bufferSize;
  }
  
  // Display the downloaded image immediately
  updateDisplay();
  
  // Cache the image now that it has been downloaded and displayed
  if (useCache && cacheEnabled) {
    bool success = cache.writeSlotFromBuffer(serverImageIndex, imageBuffer, bufferSize);
    if (success) {
      CacheHeader localHeader;
      if (cache.getHeader(localHeader)) {
        if (serverImageIndex >= (int)localHeader.total_slots) {
          localHeader.total_slots = serverImageIndex + 1;
          cache.saveHeader(localHeader);
        }
      }
    }
  }
  
  return true;
}
