/*
  cache_manager.h - SPI Flash Cache Manager for Waveshare E-Paper Shield (B)
  Uses onboard MX25R6435F 8MB SPI Flash chip (CS Pin 6)
*/

#ifndef CACHE_MANAGER_H
#define CACHE_MANAGER_H

#include <Arduino.h>
#include <SPI.h>

// SPI Flash Commands (MX25R6435F)
#define FLASH_CMD_WREN              0x06  // Write Enable
#define FLASH_CMD_WRITE             0x02  // Page Program (up to 256 bytes)
#define FLASH_CMD_READ              0x03  // Read Data Bytes
#define FLASH_CMD_RDSR              0x05  // Read Status Register
#define FLASH_CMD_SE                0x20  // Sector Erase (4KB)
#define FLASH_CMD_BE                0xD8  // Block Erase (64KB)

#define FLASH_SIZE                  8388608  // 8MB (64Mbit)

// Slot config (Each slot is aligned to a 64KB block to make erasing straightforward)
#define CACHE_HEADER_ADDR           0x000000
#define BLOCK_SIZE                  65536    // 64KB block size
#define CACHE_SLOTS_START_ADDR      65536    // Slot 0 starts at 64KB
#define MAX_SLOTS                   16       // Support up to 16 cached screens (plenty for carousel)

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

  void writeEnable() {
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(FLASH_CMD_WREN);
    deselect();
    SPI.endTransaction();
  }

  void waitBusy() {
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    while (true) {
      select();
      SPI.transfer(FLASH_CMD_RDSR);
      uint8_t status = SPI.transfer(0);
      deselect();
      if ((status & 0x01) == 0) break; // Check WIP (Write In Progress) bit
      delay(1);
    }
    SPI.endTransaction();
  }

  void eraseSector4K(uint32_t address) {
    writeEnable();
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(FLASH_CMD_SE);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    deselect();
    SPI.endTransaction();
    waitBusy();
  }

  void eraseBlock64K(uint32_t address) {
    writeEnable();
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(FLASH_CMD_BE);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    deselect();
    SPI.endTransaction();
    waitBusy();
  }

  void writePage(uint32_t address, const uint8_t* buffer, uint32_t length) {
    writeEnable();
    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(FLASH_CMD_WRITE);
    SPI.transfer((address >> 16) & 0xFF);
    SPI.transfer((address >> 8) & 0xFF);
    SPI.transfer(address & 0xFF);
    for (uint32_t i = 0; i < length; i++) {
      SPI.transfer(buffer[i]);
    }
    deselect();
    SPI.endTransaction();
    waitBusy();
  }

public:
  FlashCache(uint8_t pin) : csPin(pin) {}

  void begin() {
    pinMode(csPin, OUTPUT);
    deselect();
  }

  void writeData(uint32_t address, const uint8_t* buffer, uint32_t length) {
    if (address + length > FLASH_SIZE) return;

    // Erase the 4KB sector containing this address
    uint32_t sectorAddress = address - (address % 4096);
    eraseSector4K(sectorAddress);

    // Page Program (assuming length is small and fits in page)
    writePage(address, buffer, length);
  }

  void readData(uint32_t address, uint8_t* buffer, uint32_t length) {
    if (address + length > FLASH_SIZE) {
      memset(buffer, 0, length);
      return;
    }

    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    select();
    SPI.transfer(FLASH_CMD_READ);
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

  // Write stream to a slot in Flash memory using page program
  bool writeSlot(uint32_t slotIndex, WiFiClient& stream, uint32_t totalBytes) {
    uint32_t startAddr = CACHE_SLOTS_START_ADDR + (slotIndex * BLOCK_SIZE);
    if (startAddr + totalBytes > FLASH_SIZE) {
      Serial.print(F("[Cache Error] Slot "));
      Serial.print(slotIndex);
      Serial.println(F(" exceeds onboard Flash capacity. Skipping cache write."));
      return false;
    }

    Serial.print(F("[Cache] Erasing 64KB block at address 0x"));
    Serial.println(startAddr, HEX);
    eraseBlock64K(startAddr);

    Serial.print(F("[Cache] Writing stream to SPI Flash slot address 0x"));
    Serial.println(startAddr, HEX);

    uint8_t pageBuf[256];
    uint32_t bytesWritten = 0;
    unsigned long timeout = millis();

    while (bytesWritten < totalBytes) {
      uint32_t chunk = min((uint32_t)256, totalBytes - bytesWritten);
      uint32_t bytesRead = 0;

      // Read chunk from stream
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

      // Write page to Flash
      writePage(startAddr + bytesWritten, pageBuf, bytesRead);
      bytesWritten += bytesRead;
    }

    Serial.print(F("[Cache] Successfully wrote "));
    Serial.print(bytesWritten);
    Serial.println(F(" bytes to Flash."));
    return true;
  }
};

#endif // CACHE_MANAGER_H
