/*
  system_utils.h - System and string utility functions for XIAO Client
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
  
  // Configure external pin wakeup on KEY0, KEY1, KEY2 (pins go LOW on press)
  uint64_t pinMask = (1ULL << BTN_KEY0) | (1ULL << BTN_KEY1) | (1ULL << BTN_KEY2);
  esp_sleep_enable_ext1_wakeup(pinMask, ESP_EXT1_WAKEUP_ANY_LOW);
  
  // Execute deep sleep (resets the board upon wakeup)
  esp_deep_sleep_start();
}

// Battery voltage measurement helper for XIAO ESP32
inline float readBatteryVoltage() {
  pinMode(VBAT_ADC_PIN, INPUT);
  
  // Average 10 ADC samples to smooth out transient noise
  uint32_t sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(VBAT_ADC_PIN);
    delay(2);
  }
  float rawAdc = sum / 10.0;
  
  // 12-bit ADC (0 - 4095) with 3.3V reference and 2x voltage divider
  float voltage = (rawAdc / 4095.0) * 3.3 * 2.0;
  return voltage;
}

// Battery health status calculator
inline String getBatteryHealthStatus() {
  float v = readBatteryVoltage();

  if (v >= 4.25) {
    return "Power: USB Connected / Charging (" + String(v, 2) + "V)";
  }

  int pct = 0;
  if (v >= 4.10)      pct = 95 + (int)((v - 4.10) / 0.10 * 5);
  else if (v >= 3.80) pct = 50 + (int)((v - 3.80) / 0.30 * 45);
  else if (v >= 3.50) pct = 15 + (int)((v - 3.50) / 0.30 * 35);
  else if (v >= 3.20) pct = (int)((v - 3.20) / 0.30 * 15);
  pct = constrain(pct, 0, 100);

  if (v < 3.50) {
    return "BATTERY: CRITICAL (" + String(pct) + "% / " + String(v, 2) + "V) - Low Volts!";
  } else if (v < 3.70) {
    return "Battery Health: Low (" + String(pct) + "% / " + String(v, 2) + "V)";
  } else {
    return "Battery Health: Good (" + String(pct) + "% / " + String(v, 2) + "V)";
  }
}

#endif // SYSTEM_UTILS_H
