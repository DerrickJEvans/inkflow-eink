/*
  cache_manager.h - LittleFS Cache Manager for XIAO Client
*/

#ifndef CACHE_MANAGER_H
#define CACHE_MANAGER_H

#include <Arduino.h>
#include <LittleFS.h>
#include <WiFi.h>

#define MAX_SLOTS                   16

struct CacheHeader {
  char magic[4];              // "INKF"
  char signature[32];         // Server carousel hash hex (32 bytes)
  uint32_t width;
  uint32_t height;
  uint32_t total_slots;       // How many slots are populated
};

class FlashCache {
public:
  FlashCache(uint8_t pin) {} // Dummy constructor to match R4 API 1-to-1

  inline bool begin() {
    if (!LittleFS.begin(true)) {
      Serial.println(F("[Cache Error] LittleFS mount failed!"));
      return false;
    } else {
      Serial.println(F("[Cache] LittleFS mounted successfully."));
      return true;
    }
  }

  // Reads from header file
  inline bool getHeader(CacheHeader& header) {
    if (!LittleFS.exists("/cache_header.bin")) {
      return false;
    }
    File f = LittleFS.open("/cache_header.bin", "r");
    if (!f) return false;
    size_t readLen = f.read((uint8_t*)&header, sizeof(CacheHeader));
    f.close();
    return (readLen == sizeof(CacheHeader) && strncmp(header.magic, "INKF", 4) == 0);
  }

  // Writes new header
  inline void saveHeader(const CacheHeader& header) {
    File f = LittleFS.open("/cache_header.bin", "w");
    if (f) {
      f.write((const uint8_t*)&header, sizeof(CacheHeader));
      f.close();
      Serial.println(F("[Cache] Saved header metadata to LittleFS."));
    }
  }

  // Clear cache and write new signature
  inline void initCache(const String& newSignature, uint32_t w, uint32_t h) {
    Serial.println(F("[Cache] Invalidation triggered. Re-initializing LittleFS cache..."));
    CacheHeader header;
    strncpy(header.magic, "INKF", 4);
    memset(header.signature, 0, 32);
    memcpy(header.signature, newSignature.c_str(), min(32, (int)newSignature.length()));
    header.width = w;
    header.height = h;
    header.total_slots = 0;
    saveHeader(header);
    
    // Purge previous raw files
    for (int i = 0; i < MAX_SLOTS; i++) {
      char path[32];
      snprintf(path, sizeof(path), "/slot_%d.raw", i);
      if (LittleFS.exists(path)) {
        LittleFS.remove(path);
      }
    }
    Serial.println(F("[Cache] Cache cleared successfully."));
  }

  // Write stream to a slot in LittleFS
  inline bool writeSlot(uint32_t slotIndex, WiFiClient& stream, uint32_t totalBytes) {
    char path[32];
    snprintf(path, sizeof(path), "/slot_%d.raw", slotIndex);
    
    File f = LittleFS.open(path, "w");
    if (!f) {
      Serial.printf("[Cache Error] Failed to open %s for writing\n", path);
      return false;
    }

    Serial.printf("[Cache] Streaming raw data directly to %s (%d bytes)\n", path, totalBytes);

    uint8_t pageBuf[256];
    uint32_t bytesWritten = 0;
    unsigned long timeout = millis();

    while (bytesWritten < totalBytes) {
      uint32_t chunk = min((uint32_t)256, totalBytes - bytesWritten);
      uint32_t bytesRead = 0;

      while (bytesRead < chunk) {
        if (stream.available() > 0) {
          pageBuf[bytesRead++] = stream.read();
          timeout = millis();
        } else if (!stream.connected()) {
          Serial.println(F("[Cache Error] Stream disconnected."));
          f.close();
          LittleFS.remove(path);
          return false;
        } else if (millis() - timeout > 3000) {
          Serial.println(F("[Cache Error] Read timeout."));
          f.close();
          LittleFS.remove(path);
          return false;
        }
      }

      f.write(pageBuf, bytesRead);
      bytesWritten += bytesRead;
    }

    f.close();
    Serial.printf("[Cache] Successfully wrote slot %d file to LittleFS.\n", slotIndex);
    return true;
  }
  
  // Read raw slot file to RAM buffer
  inline bool readSlot(uint32_t slotIndex, uint8_t* buffer, uint32_t totalBytes) {
    char path[32];
    snprintf(path, sizeof(path), "/slot_%d.raw", slotIndex);
    if (!LittleFS.exists(path)) {
      return false;
    }
    File f = LittleFS.open(path, "r");
    if (!f) return false;
    size_t readBytes = f.read(buffer, totalBytes);
    f.close();
    return (readBytes == totalBytes);
  }
};

#endif // CACHE_MANAGER_H
