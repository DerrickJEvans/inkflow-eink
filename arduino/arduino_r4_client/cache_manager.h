/*
  cache_manager.h - SPI Flash Cache Manager for Waveshare E-Paper Shield
  Designed for Arduino UNO R4 WiFi & standard SPI Flash (W25Q64, 8MB)
*/

#ifndef CACHE_MANAGER_H
#define CACHE_MANAGER_H

#include <Arduino.h>
#include <SPI.h>


// Flash commands
#define FLASH_CMD_WRITE_ENABLE      0x06
#define FLASH_CMD_READ_STATUS_1     0x05
#define FLASH_CMD_READ_DATA         0x03
#define FLASH_CMD_PAGE_PROGRAM      0x02
#define FLASH_CMD_SECTOR_ERASE_4K   0x20
#define FLASH_CMD_BLOCK_ERASE_64K   0xD8

// Slot config (Each image is 64KB block-aligned)
#define BLOCK_SIZE                  65536
#define CACHE_HEADER_ADDR           0x000000
#define CACHE_SLOTS_START_ADDR      0x010000
#define MAX_SLOTS                   100

struct CacheHeader {
  char magic[4];              // "INKF"
  char signature[32];         // Server carousel hash hex (32 bytes)
  uint32_t width;
  uint32_t height;
  uint32_t total_slots;       // How many slots are populated
};

// Class to manage cache

class FlashCache {
private:
  uint8_t csPin;

  void select() {
    digitalWrite(csPin, LOW);
  }

  void deselect() {
    digitalWrite(csPin, HIGH);
  }

  void writeEnable() {
    select();
    SPI.transfer(FLASH_CMD_WRITE_ENABLE);
    deselect();
  }

  void waitBusy() {
    while (true) {
      select();
      SPI.transfer(FLASH_CMD_READ_STATUS_1);
      uint8_t status = SPI.transfer(0);
      deselect();
      if ((status & 0x01) == 0) break; // Check Write In Progress (WIP) bit
      delay(1);
    }
  }

public:
  FlashCache(uint8_t pin) : csPin(pin) {}

  void begin() {
    pinMode(csPin, OUTPUT);
    deselect();
  }

  void eraseBlock64K(uint32_t address) {
    writeEnable();
    select();
    SPI.transfer(FLASH_CMD_BLOCK_ERASE_64K);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    deselect();
    waitBusy();
  }

  void writeData(uint32_t address, const uint8_t* buffer, uint32_t length) {
    uint32_t bytesWritten = 0;
    while (bytesWritten < length) {
      uint32_t pageAddr = address + bytesWritten;
      uint32_t maxWrite = 256 - (pageAddr % 256); // Don't cross 256-byte page boundary
      uint32_t chunk = min(maxWrite, length - bytesWritten);

      writeEnable();
      select();
      SPI.transfer(FLASH_CMD_PAGE_PROGRAM);
      SPI.transfer((pageAddr >> 16) & 0xFF);
      SPI.transfer((pageAddr >> 8) & 0xFF);
      SPI.transfer(pageAddr & 0xFF);
      for (uint32_t i = 0; i < chunk; i++) {
        SPI.transfer(buffer[bytesWritten + i]);
      }
      deselect();
      waitBusy();

      bytesWritten += chunk;
    }
  }

  void readData(uint32_t address, uint8_t* buffer, uint32_t length) {
    select();
    SPI.transfer(FLASH_CMD_READ_DATA);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    for (uint32_t i = 0; i < length; i++) {
      buffer[i] = SPI.transfer(0);
    }
    deselect();
  }

  // Reads from header block
  bool getHeader(CacheHeader& header) {
    readData(CACHE_HEADER_ADDR, (uint8_t*)&header, sizeof(CacheHeader));
    return (strncmp(header.magic, "INKF", 4) == 0);
  }

  // Writes new header
  void saveHeader(const CacheHeader& header) {
    eraseBlock64K(CACHE_HEADER_ADDR);
    writeData(CACHE_HEADER_ADDR, (const uint8_t*)&header, sizeof(CacheHeader));
  }

  // Clear cache and write new signature
  void initCache(const String& newSignature, uint32_t w, uint32_t h) {
    Serial.println(F("[Cache] Invalidation triggered. Re-initializing SPI Flash..."));
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

  // Write stream directly to a slot in Flash memory (chunked pages to minimize RAM)
  bool writeSlot(uint32_t slotIndex, WiFiClient& stream, uint32_t totalBytes) {
    uint32_t startAddr = CACHE_SLOTS_START_ADDR + (slotIndex * BLOCK_SIZE);
    Serial.print(F("[Cache] Erasing slot block at 0x"));
    Serial.println(startAddr, HEX);
    eraseBlock64K(startAddr);

    uint8_t pageBuf[256];
    uint32_t bytesWritten = 0;

    Serial.println(F("[Cache] Writing stream directly to SPI Flash slot..."));
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
          return false;
        } else if (millis() - timeout > 3000) {
          Serial.println(F("[Cache Error] Read timeout."));
          return false;
        }
      }

      writeData(startAddr + bytesWritten, pageBuf, chunk);
      bytesWritten += chunk;
    }

    Serial.print(F("[Cache] Successfully wrote "));
    Serial.print(bytesWritten);
    Serial.println(F(" bytes to Flash."));
    return true;
  }
};

#endif // CACHE_MANAGER_H
