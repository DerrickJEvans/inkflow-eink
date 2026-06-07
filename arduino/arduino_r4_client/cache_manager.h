/*
  cache_manager.h - SPI RAM Cache Manager for Waveshare E-Paper Shield (23LC1024 SRAM)
  Designed for Arduino UNO R4 WiFi & onboard 128KB SPI SRAM
*/

#ifndef CACHE_MANAGER_H
#define CACHE_MANAGER_H

#include <Arduino.h>
#include <SPI.h>

// 23LC1024 Commands
#define SRAM_CMD_WRITE              0x02
#define SRAM_CMD_READ               0x03
#define SRAM_CMD_RDMR               0x05  // Read Mode Register
#define SRAM_CMD_WRMR               0x01  // Write Mode Register

// Mode Register values
#define SRAM_MODE_BYTE              0x00
#define SRAM_MODE_SEQUENTIAL        0x40

#define SRAM_SIZE                   131072  // 128KB

// Slot config (Each image is dynamically sized based on display)
#define CACHE_HEADER_ADDR           0x000000
#define CACHE_SLOTS_START_ADDR      256
#define BLOCK_SIZE                  (((uint32_t)DISPLAY_WIDTH * DISPLAY_HEIGHT) / 8)
#define MAX_SLOTS                   (SRAM_SIZE / BLOCK_SIZE)

struct CacheHeader {
  char magic[4];              // "INKF"
  char signature[32];         // Server carousel hash hex (32 bytes)
  uint32_t width;
  uint32_t height;
  uint32_t total_slots;       // How many slots are populated
};

class FlashCache {
private:
  uint8_t csPin;

  void select() {
    digitalWrite(csPin, LOW);
  }

  void deselect() {
    digitalWrite(csPin, HIGH);
  }

  void setSequentialMode() {
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(SRAM_CMD_WRMR);
    SPI.transfer(SRAM_MODE_SEQUENTIAL);
    deselect();
    SPI.endTransaction();
  }

public:
  FlashCache(uint8_t pin) : csPin(pin) {}

  void begin() {
    pinMode(csPin, OUTPUT);
    deselect();
    setSequentialMode();
  }

  void eraseBlock64K(uint32_t address) {
    // SRAM does not need erasing! No-op.
  }

  void writeData(uint32_t address, const uint8_t* buffer, uint32_t length) {
    if (address + length > SRAM_SIZE) return;

    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(SRAM_CMD_WRITE);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    for (uint32_t i = 0; i < length; i++) {
      SPI.transfer(buffer[i]);
    }
    deselect();
    SPI.endTransaction();
  }

  void readData(uint32_t address, uint8_t* buffer, uint32_t length) {
    if (address + length > SRAM_SIZE) {
      memset(buffer, 0, length);
      return;
    }

    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(SRAM_CMD_READ);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    for (uint32_t i = 0; i < length; i++) {
      buffer[i] = SPI.transfer(0);
    }
    deselect();
    SPI.endTransaction();
  }

  // Reads from header block
  bool getHeader(CacheHeader& header) {
    readData(CACHE_HEADER_ADDR, (uint8_t*)&header, sizeof(CacheHeader));
    return (strncmp(header.magic, "INKF", 4) == 0);
  }

  // Writes new header
  void saveHeader(const CacheHeader& header) {
    writeData(CACHE_HEADER_ADDR, (const uint8_t*)&header, sizeof(CacheHeader));
  }

  // Clear cache and write new signature
  void initCache(const String& newSignature, uint32_t w, uint32_t h) {
    Serial.println(F("[Cache] Invalidation triggered. Re-initializing SPI RAM..."));
    CacheHeader header;
    strncpy(header.magic, "INKF", 4);
    memset(header.signature, 0, 32);
    memcpy(header.signature, newSignature.c_str(), min(32, (int)newSignature.length()));
    header.width = w;
    header.height = h;
    header.total_slots = 0;
    saveHeader(header);
    Serial.println(F("[Cache] Initialized successfully."));
  }

  // Write stream directly to a slot in RAM memory
  bool writeSlot(uint32_t slotIndex, WiFiClient& stream, uint32_t totalBytes) {
    uint32_t startAddr = CACHE_SLOTS_START_ADDR + (slotIndex * BLOCK_SIZE);
    if (startAddr + totalBytes > SRAM_SIZE) {
      Serial.print(F("[Cache Error] Slot "));
      Serial.print(slotIndex);
      Serial.println(F(" exceeds onboard 128KB SRAM capacity. Skipping cache write."));
      return false;
    }

    Serial.print(F("[Cache] Writing stream directly to SPI RAM slot address 0x"));
    Serial.println(startAddr, HEX);

    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(SRAM_CMD_WRITE);
    SPI.transfer((startAddr >> 16) & 0xFF);
    SPI.transfer((startAddr >> 8) & 0xFF);
    SPI.transfer(startAddr & 0xFF);

    uint32_t bytesWritten = 0;
    unsigned long timeout = millis();

    while (bytesWritten < totalBytes) {
      if (stream.available() > 0) {
        SPI.transfer(stream.read());
        bytesWritten++;
        timeout = millis();
      } else if (!stream.connected()) {
        deselect();
        SPI.endTransaction();
        Serial.println(F("[Cache Error] Stream disconnected."));
        return false;
      } else if (millis() - timeout > 3000) {
        deselect();
        SPI.endTransaction();
        Serial.println(F("[Cache Error] Read timeout."));
        return false;
      }
    }

    deselect();
    SPI.endTransaction();
    Serial.print(F("[Cache] Successfully wrote "));
    Serial.print(bytesWritten);
    Serial.println(F(" bytes to RAM."));
    return true;
  }
};

#endif // CACHE_MANAGER_H
