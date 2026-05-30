/*
  config.h - Configuration Settings for the ESP32 E-Ink Client
*/

#ifndef CONFIG_H
#define CONFIG_H

// 1. WiFi Settings
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// 2. Server Settings (Change to your Raspberry Pi's local IP address)
const char* serverIp   = "192.168.1.100";
const int   serverPort = 5000;

// 3. Dynamic Device Naming
// Setting this automatically updates your screen name in the Control Center!
const char* customDeviceName = "Living Room ESP32 Panel";

// 4. E-Paper Screen Selection
// Simply uncomment your exact Waveshare display screen size:
#define SCREEN_TYPE_4_20      // Waveshare 4.2" (400x300 B&W) - Recommended Default
//#define SCREEN_TYPE_7_50    // Waveshare 7.5" (800x480 B&W Version 2)
//#define SCREEN_TYPE_2_90    // Waveshare 2.9" (296x128 B&W)
//#define SCREEN_TYPE_2_70    // Waveshare 2.7" (264x176 B&W)

// Default sleep duration (seconds) if server header is missing
const int fallbackSleepSeconds = 1800;

// 5. SPI Pin Mappings (Waveshare ESP32 Board / Standard ESP32)
#define EPD_CS    15 // Chip Select (Change to 5 if using dedicated ESP32 Driver Board without Flash)
#define EPD_DC    17 // Data/Command
#define EPD_RST   16 // Reset
#define EPD_BUSY  4  // Busy Indicator

#endif // CONFIG_H
