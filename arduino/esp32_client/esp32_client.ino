/*
  esp32_client.ino - E-Paper Dashboard Client for ESP32 & Waveshare HAT
  
  Architecture: Low-RAM Direct SPI Caching & LittleFS Wifi Wizard
  ──────────────────────────────────────────────────────────────────
  Downloads dithered raw 1-bit monochrome byte arrays from the InkFlow server,
  caches them locally in ESP32 LittleFS partition blocks for carousel rotation,
  and displays them on Waveshare E-Paper screens.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <GxEPD2_3C.h> 
#include <GxEPD2_BW.h> 
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

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
extern const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);

// Global settings
EEPROMConfig activeConfig;
extern const uint32_t CONFIG_MAGIC = 0xDEFAEC20;
int nextRefreshSeconds = fallbackSleepSeconds;
String lastConnectionError = "";

// Caching parameters
FlashCache cache(0); // Pin ignored in LittleFS
int currentCacheSlot = -1;
bool cacheEnabled = true;
const int bufferSize = (displayWidth * displayHeight) / 8;
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
  Serial.println("\n--- InkFlow ESP32 Client Awake (Refactored) ---");

  // Disable onboard flash chip (Pin 5) and SD Card (Pin 4) on standard shield
  // to protect SPI lines from signal collisions
  pinMode(5, OUTPUT);
  digitalWrite(5, HIGH); 
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH); 

  // Initialize LittleFS Partition Cache
  cache.begin();

  // Load Preferences configurations
  loadConfiguration();


  // Allocate image buffer in RAM
  imageBuffer = (uint8_t*)malloc(bufferSize);
  if (imageBuffer == nullptr) {
    Serial.println("[Error] Failed to allocate RAM for screen buffer!");
    goToSleep(fallbackSleepSeconds);
  }
  memset(imageBuffer, 0xFF, bufferSize); // Pre-fill with White

  // Connect to WiFi and Sync
  if (connectWiFi()) {
    if (fetchAndStreamDisplay()) {
      Serial.println(F("[Success] Display synced successfully."));
    } else {
      Serial.println(F("[Warning] Direct stream failed. Checking cache..."));
      loadOfflineCache();
    }
  } else {
    Serial.println(F("[Warning] WiFi connection failed. Checking cache..."));
    loadOfflineCache();
  }

  // Release RAM
  free(imageBuffer);

  // Enter deep sleep
  goToSleep(nextRefreshSeconds);
}

void loop() {
  // Loop is unused as ESP32 wakes up from deep sleep, runs setup(), and sleeps again.
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

  if (imageBuffer != nullptr) {
    if (cache.readSlot(slotIndex, imageBuffer, bufferSize)) {
      updateDisplay();
    } else {
      Serial.println(F("[Cache Error] Failed to read cached slot file."));
    }
  } else {
    Serial.println(F("[Error] Failed to allocate RAM for cached image draw."));
  }
}

void updateDisplay() {
  Serial.println("[Display] Initializing GxEPD2 SPI interface...");
  display.init(115200); 
  
  Serial.println("[Display] Pushing raw dithered horizontal bitmap page-by-page...");
  
  display.firstPage();
  do {
    display.drawBitmap(0, 0, imageBuffer, displayWidth, displayHeight, GxEPD_BLACK, GxEPD_WHITE);
  } while (display.nextPage());
  
  delay(2000); // Pixel stabilization
  
  Serial.println("[Display] Powering down e-ink display SPI panel...");
  display.powerOff();
  Serial.println("[Display] Screen updated successfully!");
}

bool fetchAndStreamDisplay(String action) {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  HTTPClient http;
  String macAddress = WiFi.macAddress();
  
  char url[256];
  snprintf(url, sizeof(url), "http://%s:%d/api/display/raw?device=%s&width=%d&height=%d", 
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
  http.addHeader("FW-Version", "InkFlow-ESP32-v1.2.0");
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
  
  // Download stream into RAM buffer
  if (imageBuffer == nullptr) {
    imageBuffer = (uint8_t*)malloc(bufferSize);
  }
  
  if (imageBuffer == nullptr) {
    Serial.println(F("[Error] Failed to allocate RAM for screen buffer download!"));
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
    memset(imageBuffer + bytesRead, 0xFF, bufferSize - bytesRead);
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
