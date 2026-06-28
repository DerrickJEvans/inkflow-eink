/*
  config.h - Configuration Settings for the ESP32 E-Ink Client
*/

#ifndef CONFIG_H
#define CONFIG_H

// 1. WiFi Settings
// These act as hardcoded defaults if no settings are saved via the E-Ink Setup Wizard.
String default_ssid     = "YOUR_WIFI_SSID";
String default_password = "YOUR_WIFI_PASSWORD";

// 2. Server Settings (Change to your Raspberry Pi's local IP address or DNS name)
String default_serverIp   = "192.168.1.100";
int    default_serverPort = 5000;

// 3. Dynamic Device Naming
// Setting this automatically updates your screen name in the Control Center!
String default_deviceName = "Living Room ESP32 Panel";

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

// ==============================================================================
//                  DYNAMIC DRIVER & SIZE RESOLUTION
// ==============================================================================
#if defined(SCREEN_TYPE_4_20)
  #define DISPLAY_WIDTH  400
  #define DISPLAY_HEIGHT 300
  GxEPD2_BW<GxEPD2_420, GxEPD2_420::HEIGHT> display(GxEPD2_420(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
#elif defined(SCREEN_TYPE_7_50)
  #define DISPLAY_WIDTH  800
  #define DISPLAY_HEIGHT 480
  GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT> display(GxEPD2_750_T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
#elif defined(SCREEN_TYPE_2_90)
  #define DISPLAY_WIDTH  296
  #define DISPLAY_HEIGHT 128
  GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(GxEPD2_290_T94(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
#elif defined(SCREEN_TYPE_2_70)
  #define DISPLAY_WIDTH  264
  #define DISPLAY_HEIGHT 176
  GxEPD2_BW<GxEPD2_270, GxEPD2_270::HEIGHT> display(GxEPD2_270(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
#else
  #error "No valid SCREEN_TYPE defined! Please uncomment one of the screen options in config.h."
#endif

const int displayWidth = DISPLAY_WIDTH;
const int displayHeight = DISPLAY_HEIGHT;

#endif // CONFIG_H
