/*
  system_utils.h - System and string utility functions for ESP32 Client
*/

#ifndef SYSTEM_UTILS_H
#define SYSTEM_UTILS_H

#include <Arduino.h>
#include <WiFi.h>
#include "config.h"
#include "config_manager.h"

// Hex character to decimal helper
inline unsigned char h2d(char hex) {
  if (hex >= '0' && hex <= '9') return hex - '0';
  if (hex >= 'a' && hex <= 'f') return hex - 'a' + 10;
  if (hex >= 'A' && hex <= 'F') return hex - 'A' + 10;
  return 0;
}

// Simple URL decoding utility
inline String urlDecode(String str) {
  String decoded = "";
  char c;
  char code0;
  char code1;
  for (unsigned int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (c == '+') {
      decoded += ' ';
    } else if (c == '%') {
      i++;
      code0 = str.charAt(i);
      i++;
      code1 = str.charAt(i);
      c = (h2d(code0) << 4) | h2d(code1);
      decoded += c;
    } else {
      decoded += c;
    }
  }
  return decoded;
}

// Helper function to extract URL-encoded form parameters
inline String parseUrlParam(String body, String paramName) {
  int nameIdx = body.indexOf(paramName + "=");
  if (nameIdx == -1) return "";
  
  int valStart = nameIdx + paramName.length() + 1;
  int valEnd = body.indexOf('&', valStart);
  if (valEnd == -1) valEnd = body.length();
  
  return body.substring(valStart, valEnd);
}

// Low-power standby sleep configuration
inline void goToSleep(int seconds) {
  Serial.printf("[Power] Entering Deep Sleep for %d seconds...\n", seconds);
  
  // Power down WiFi radio
  WiFi.disconnect(true);
  
  // Configure ESP32 deep sleep timer
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  
  // Execute deep sleep (resets the board upon wakeup)
  esp_deep_sleep_start();
}

#endif // SYSTEM_UTILS_H
