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

// Battery voltage measurement helper for XIAO ESP32 / EE04
inline float readBatteryVoltage() {
  // Candidate ADC pins across XIAO ESP32-S3 & expansion boards:
  // GPIO 14: Onboard XIAO ESP32-S3 VBAT ADC channel
  // GPIO 1 (A0): External expansion / EE04 board ADC channel
  const int candidatePins[] = {14, 1, 2, 3};
  float maxVoltage = 0.0;

  analogReadResolution(12);

  for (int i = 0; i < 4; i++) {
    int pin = candidatePins[i];
    
    // Take calibrated millivolts reading using ESP32 eFuse calibration
    uint32_t sumMv = 0;
    for (int s = 0; s < 5; s++) {
      sumMv += analogReadMilliVolts(pin);
      delay(1);
    }
    float avgMv = sumMv / 5.0;
    
    // Apply 2x resistor divider multiplier (100k/100k)
    float v = (avgMv * 2.0) / 1000.0;
    
    if (v > maxVoltage) {
      maxVoltage = v;
    }
  }
  
  return maxVoltage;
}

// Estimate remaining charge time in minutes based on battery voltage, capacity, and charge current
inline int getEstimateChargeMinutesLeft(float v, int batteryCapacityMh = 1000, int chargeCurrentMa = 350) {
  if (v >= 4.22) return 0; // Fully charged
  
  int pct = 0;
  if (v >= 4.10)      pct = 95 + (int)((v - 4.10) / 0.10 * 5);
  else if (v >= 3.80) pct = 50 + (int)((v - 3.80) / 0.30 * 45);
  else if (v >= 3.50) pct = 15 + (int)((v - 3.50) / 0.30 * 35);
  else if (v >= 3.20) pct = (int)((v - 3.20) / 0.30 * 15);
  pct = constrain(pct, 0, 100);

  float missingCapacityMh = batteryCapacityMh * ((100.0 - pct) / 100.0);
  float hoursNeeded = (missingCapacityMh / (float)chargeCurrentMa) * 1.15;
  int minutesNeeded = (int)(hoursNeeded * 60.0);

  // In Constant Voltage (CV) phase (v >= 4.10V), current tapers down, taking at least 15-20 mins for top-off
  if (v >= 4.10 && minutesNeeded < 20) {
    minutesNeeded = 20;
  }

  return minutesNeeded;
}

// Battery health status calculator
inline String getBatteryHealthStatus() {
  float v = readBatteryVoltage();

  // If voltage reading is under 1.0V, no battery ADC pin is connected/routed (USB power active)
  if (v < 1.00) {
    return "Power: USB / External Power (Active)";
  }

  int pct = 0;
  if (v >= 4.10)      pct = 95 + (int)((v - 4.10) / 0.10 * 5);
  else if (v >= 3.80) pct = 50 + (int)((v - 3.80) / 0.30 * 45);
  else if (v >= 3.50) pct = 15 + (int)((v - 3.50) / 0.30 * 35);
  else if (v >= 3.20) pct = (int)((v - 3.20) / 0.30 * 15);
  pct = constrain(pct, 0, 100);

  // If voltage is >= 4.22V, battery is completely full
  if (v >= 4.22) {
    return "Power: USB / Fully Charged (100% / " + String(v, 2) + "V)";
  }

  int minsLeft = getEstimateChargeMinutesLeft(v);
  
  if (v < 3.50) {
    return "BATTERY: CRITICAL (" + String(pct) + "% / " + String(v, 2) + "V) - Low Volts!";
  } else if (v < 3.70) {
    return "Battery: Low (" + String(pct) + "% / " + String(v, 2) + "V) - ~" + String(minsLeft) + "m to full";
  } else {
    return "Battery: Good (" + String(pct) + "% / " + String(v, 2) + "V) - ~" + String(minsLeft) + "m to full";
  }
}

#endif // SYSTEM_UTILS_H
