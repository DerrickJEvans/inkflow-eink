/*
  config.h - Configuration Settings for the XIAO ESP32-S3 E-Ink Client
*/

#ifndef CONFIG_H
#define CONFIG_H

#include "TFT_eSPI.h"

// 1. WiFi Settings
// These act as hardcoded defaults if no settings are saved via the E-Ink Setup Wizard.
String default_ssid     = "PLUSNET-TQC29S";
String default_password = "KtYAvLrd4bvuE9";

// 2. Server Settings (Change to your Raspberry Pi's local IP address or DNS name)
String default_serverIp   = "inkflow.local";
int    default_serverPort = 5000;

// 3. Dynamic Device Naming
String default_deviceName = "XIAO ePaper Status Panel";

// 4. E-Paper Screen Constants
#define DISPLAY_WIDTH  800
#define DISPLAY_HEIGHT 480

const int displayWidth = DISPLAY_WIDTH;
const int displayHeight = DISPLAY_HEIGHT;

// Default sleep duration (seconds) if server header is missing
const int fallbackSleepSeconds = 1800;

// 5. Onboard Buttons Pin Mappings (Seeed Studio XIAO ePaper Display Board EE04)
#define BTN_KEY0   2 // KEY0 (GPIO 2) - Wakes and fetches Previous carousel slide
#define BTN_KEY1   3 // KEY1 (GPIO 3) - Wakes and fetches Next carousel slide
#define BTN_KEY2   5 // KEY2 (GPIO 5) - Wakes and triggers Diagnostics / Setup

// 6. Global Display Driver Object
#ifdef EPAPER_ENABLE
extern EPaper epaper;
#else
#error "EPaper support not enabled! Check if driver.h defines BOARD_SCREEN_COMBO correctly."
#endif

// Buffer size for 4-level grayscale (4bpp, 2 pixels per byte)
// 800 * 480 / 2 = 192,000 bytes
const int bufferSize = (displayWidth * displayHeight) / 2;

#endif // CONFIG_H
