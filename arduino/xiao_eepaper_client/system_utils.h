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

// Battery voltage measurement helper for Seeed Studio XIAO ePaper Board EE04
// Official TRMNL BYOD & Seeed Studio EE04 Hardware Spec:
// - ADC Enable Pin (MOSFET Gate): GPIO 6 (D5)
// - ADC Measurement Pin: GPIO 1 (A0)
inline float readBatteryVoltage() {
  const int BAT_ENABLE_PIN = 6; // GPIO 6 (D5)
  const int BAT_ADC_PIN    = 1; // GPIO 1 (A0)

  // 1. Turn ON the onboard voltage divider circuit
  pinMode(BAT_ENABLE_PIN, OUTPUT);
  digitalWrite(BAT_ENABLE_PIN, HIGH);
  delay(10); // Allow voltage to settle

  // 2. Sample ADC voltage on A0 (GPIO 1) using calibrated ESP32 eFuse readings
  analogReadResolution(12);
  pinMode(BAT_ADC_PIN, INPUT);

  uint32_t sumMv = 0;
  for (int s = 0; s < 10; s++) {
    sumMv += analogReadMilliVolts(BAT_ADC_PIN);
    delay(1);
  }
  float avgMv = sumMv / 10.0;

  // 3. Turn OFF the voltage divider circuit to prevent battery drain during deep sleep
  digitalWrite(BAT_ENABLE_PIN, LOW);
  pinMode(BAT_ENABLE_PIN, INPUT);

  // 4. Calculate actual LiPo battery voltage (2x voltage divider multiplier)
  float v = (avgMv * 2.0) / 1000.0;

  if (v >= 1.00 && v <= 4.35) {
    return v;
  }

  return 0.0;
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
