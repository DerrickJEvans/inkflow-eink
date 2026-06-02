/*
  config.h - Configuration Settings for the UNO R4 WiFi E-Ink Client
*/

#ifndef CONFIG_H
#define CONFIG_H

// 1. WiFi Settings
// These act as hardcoded defaults if no settings are saved via the setup portal.
String default_ssid     = "YOUR_WIFI_SSID";
String default_password = "YOUR_WIFI_PASSWORD";

// 2. Server Settings (Your Raspberry Pi's local IP address or DNS name)
String default_serverIp   = "192.168.1.100";
int    default_serverPort = 5000;

// 3. Dynamic Device Naming
// Setting this automatically updates your screen name in the Control Center!
String default_deviceName = "Living Room R4 Panel";

// 4. E-Paper Screen Selection
// Simply uncomment your exact Waveshare display screen size model:
#define SCREEN_TYPE_4_26      // Waveshare 4.26" (800x480 B&W) - Recommended Default
//#define SCREEN_TYPE_7_50    // Waveshare 7.5" (800x480 B&W V2)
//#define SCREEN_TYPE_4_20    // Waveshare 4.2" (400x300 B&W)
//#define SCREEN_TYPE_2_90    // Waveshare 2.9" (296x128 B&W)

// Default refresh interval (seconds) if server header is missing
const int fallbackSleepSeconds = 30;

// 5. SPI Pin Mappings
#define EPD_CS    10
#define RAM_CS    5   
#define SD_CS     6   

// ==============================================================================
//                  DYNAMIC DRIVER & SIZE RESOLUTION
// ==============================================================================
#if defined(SCREEN_TYPE_4_26)
  #include "epd4in26.h"
  #define DISPLAY_WIDTH  800
  #define DISPLAY_HEIGHT 480
  #define EPD_WAIT_BUSY(epdInstance) (epdInstance).ReadBusy()
#elif defined(SCREEN_TYPE_7_50)
  #include "epd7in5_V2.h"
  #define DISPLAY_WIDTH  800
  #define DISPLAY_HEIGHT 480
  #define EPD_WAIT_BUSY(epdInstance) (epdInstance).WaitUntilIdle()
#elif defined(SCREEN_TYPE_4_20)
  #include "epd4in2.h"
  #define DISPLAY_WIDTH  400
  #define DISPLAY_HEIGHT 300
  #define EPD_WAIT_BUSY(epdInstance) (epdInstance).ReadBusy()
#elif defined(SCREEN_TYPE_2_90)
  #include "epd2in9.h"
  #define DISPLAY_WIDTH  296
  #define DISPLAY_HEIGHT 128
  #define EPD_WAIT_BUSY(epdInstance) (epdInstance).ReadBusy()
#else
  #error "No valid SCREEN_TYPE defined! Please uncomment one of the screen options in config.h."
#endif

const int displayWidth = DISPLAY_WIDTH;
const int displayHeight = DISPLAY_HEIGHT;

#endif // CONFIG_H
