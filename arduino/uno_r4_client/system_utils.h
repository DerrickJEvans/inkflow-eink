/*
  system_utils.h - System and string utility functions for Arduino UNO R4 Client
*/

#ifndef SYSTEM_UTILS_H
#define SYSTEM_UTILS_H

#include <Arduino.h>
#include <RTC.h>
#include <WiFiS3.h>
#include "config.h"
#include "config_manager.h"

extern Epd epd;

// Battery backup registers to pass wakeup button data across NVIC_SystemReset/bootloader
extern const int VBTBKR_ACTION_INDEX;
extern const int VBTBKR_MAGIC_INDEX;
extern const uint8_t VBTBKR_MAGIC_VAL;

// Pin declarations
#define PIN_PREV   2
#define PIN_NEXT   3
#define PIN_DIAG   A1
#define PIN_AP     A2

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

// ISRs for interrupts
inline void alarmISR() {
  // Trigger wakeup
}

inline void prevButtonISR() {
  pinMode(PIN_PREV, INPUT); // Immediately stop output drive to prevent short-circuit
  R_SYSTEM->PRCR = 0xA502;
  R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX] = 1;
  R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = VBTBKR_MAGIC_VAL;
  R_SYSTEM->PRCR = 0xA500;
}

inline void nextButtonISR() {
  pinMode(PIN_NEXT, INPUT); // Immediately stop output drive to prevent short-circuit
  R_SYSTEM->PRCR = 0xA502;
  R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX] = 2;
  R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = VBTBKR_MAGIC_VAL;
  R_SYSTEM->PRCR = 0xA500;
}

inline void diagButtonISR() {
  R_SYSTEM->PRCR = 0xA502;
  R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX] = 3;
  R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = VBTBKR_MAGIC_VAL;
  R_SYSTEM->PRCR = 0xA500;
}

inline void apButtonISR() {
  R_SYSTEM->PRCR = 0xA502;
  R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX] = 4;
  R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = VBTBKR_MAGIC_VAL;
  R_SYSTEM->PRCR = 0xA500;
}

inline void goToSleep(int seconds) {
  Serial.print(F("[Power] Preparing to enter standby sleep for "));
  Serial.print(seconds);
  Serial.println(F(" seconds..."));
  
  // 1. Put E-Paper screen controller to low power sleep
  epd.Sleep();
  delay(100);
  
  // 2. Terminate WiFi connection and co-processor
  WiFi.end();
  delay(200);
  
  // 3. Configure the RTC Alarm wake-up source
  RTCTime currentTime;
  AlarmMatch matchTime;
  matchTime.addMatchSecond();
  matchTime.addMatchMinute();
  matchTime.addMatchHour();
  matchTime.addMatchDay();
  matchTime.addMatchMonth();
  matchTime.addMatchYear();
 
  if (RTC.getTime(currentTime)) {
    unsigned long currentUnix = currentTime.getUnixTime();
    RTCTime alarmTime;
    alarmTime.setUnixTime(currentUnix + seconds);
    RTC.setAlarmCallback(alarmISR, alarmTime, matchTime);
  } else {
    Serial.println(F("[Power Warning] RTC time read failed. Using fallback alarm time."));
    RTCTime defaultTime(25, Month::JUNE, 2026, 12, 0, 0, DayOfWeek::THURSDAY, SaveLight::SAVING_TIME_INACTIVE);
    RTC.setTime(defaultTime);
    defaultTime.setUnixTime(defaultTime.getUnixTime() + seconds);
    RTC.setAlarmCallback(alarmISR, defaultTime, matchTime);
  }
  
  // 4. Software Workaround: Force level-shifter lines HIGH before sleep
  pinMode(PIN_PREV, OUTPUT);
  digitalWrite(PIN_PREV, HIGH);
  pinMode(PIN_NEXT, OUTPUT);
  digitalWrite(PIN_NEXT, HIGH);
  delay(5); // Settle line state

  // Clear previous wakeup details in battery backup registers (default to 0: timer wakeup)
  R_SYSTEM->PRCR = 0xA502;
  R_SYSTEM->VBTBKR[VBTBKR_ACTION_INDEX] = 0;
  R_SYSTEM->VBTBKR[VBTBKR_MAGIC_INDEX] = 0;
  R_SYSTEM->PRCR = 0xA500;

  // Attach external pin interrupts to wake on button press (common cathode -> FALLING)
  attachInterrupt(digitalPinToInterrupt(PIN_PREV), prevButtonISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_NEXT), nextButtonISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_DIAG), diagButtonISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_AP),   apButtonISR, FALLING);
  
  // 5. Configure Renesas RA4M1 System Standby Control register
  R_SYSTEM->PRCR = 0xA503;       // Unlock system registers
  R_SYSTEM->SBYCR_b.SSBY = 1;    // Select Software Standby Mode
  R_SYSTEM->OSTDCR = 0x00;       // Disable Oscillation Stop Detection to allow Software Standby
  R_SYSTEM->PRCR = 0xA500;       // Lock system registers

  // Configure Wake Up Interrupt Enable Register (WUPEN)
  R_ICU->WUPEN = (1UL << 24) | (1UL << 7) | (1UL << 6) | (1UL << 1) | (1UL << 0);
  
  // Disable SysTick interrupt to prevent it from waking the MCU immediately
  SysTick->CTRL &= ~SysTick_CTRL_TICKINT_Msk;

  // 6. Execute Wait-For-Interrupt to enter Software Standby
  __asm volatile("wfi");

  // Re-enable SysTick interrupt
  SysTick->CTRL |= SysTick_CTRL_TICKINT_Msk;

  // 7. Woken up! Detach interrupts immediately first to prevent false falling edges when releasing output driven pins
  detachInterrupt(digitalPinToInterrupt(PIN_PREV));
  detachInterrupt(digitalPinToInterrupt(PIN_NEXT));
  detachInterrupt(digitalPinToInterrupt(PIN_DIAG));
  detachInterrupt(digitalPinToInterrupt(PIN_AP));

  // Immediately release output drive upon wakeup to prevent short circuits
  pinMode(PIN_PREV, INPUT);
  pinMode(PIN_NEXT, INPUT);
  
  // 8. Trigger clean reboot to re-init WiFi and all board peripherals cleanly
  Serial.println(F("[Power] Woken up. Rebooting..."));
  delay(100);
  NVIC_SystemReset();
}

#endif // SYSTEM_UTILS_H
