/*
  arduino_client.ino - E-Paper Dashboard Client for ESP32 & Waveshare HAT
  
  Downloads raw 1-bit monochrome horizontal bit-packed byte arrays from
  the TRMNL Pi server and displays them on Waveshare E-Paper screens.
  
  Uses GxEPD2: Install via Arduino Library Manager (GxEPD2 & Adafruit GFX)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <GxEPD2_3C.h> // Supports 3-color (Black/White/Red) or monochrome screens
#include <GxEPD2_BW.h> // Supports monochrome (Black/White) screens

// ==========================================
//           CONFIGURATION SETTINGS
// ==========================================

// WiFi Settings
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Server Settings (Change to your Raspberry Pi's local IP address)
const char* serverIp = "192.168.1.100";
const int serverPort = 5000;

// Device Specifications (deviceId is dynamically fetched from your hardware MAC address at boot)
const int displayWidth = 400;  // Adjust to match your physical display (e.g., 400 for 4.2", 800 for 7.5")
const int displayHeight = 300; // Adjust to match your physical display (e.g., 300 for 4.2", 480 for 7.5")

// Default sleep duration (seconds) if server header is missing
const int fallbackSleepSeconds = 1800; 

// ==========================================
//          E-PAPER SPI PIN MAPPINGS
// ==========================================
// Default wiring for Waveshare E-Paper ESP32 Driver Board or standard ESP32 boards.
// 
// ⚠️ SHIELD CONFLICT WARNING:
// On the Waveshare Arduino E-Paper Shield or HAT, the onboard SPI serial Flash CS pin 
// is hardwired to GPIO 5, and the SD Card CS is hardwired to GPIO 4.
// If you are using this shield, you MUST pull GPIO 5 and 4 HIGH to disable them, and 
// remap the E-Paper's CS pin to another pin (e.g. GPIO 15, 10, or 25) to prevent SPI collisions!
#define EPD_CS    15 // Chip Select (Change to 5 if using dedicated ESP32 Driver Board without Flash)
#define EPD_DC    17 // Data/Command
#define EPD_RST   16 // Reset
#define EPD_BUSY  4  // Busy Indicator
// Note: SPI SCK binds to pin 18, and MOSI/DIN binds to pin 23 by default.


// ==========================================
//      GxEPD2 DISPLAY DRIVER SELECTION
// ==========================================
// Uncomment the line that corresponds to your exact Waveshare display model:

// For Waveshare 4.2" Black & White screen (400x300) [RECOMMENDED DEFAULT]
GxEPD2_BW<GxEPD2_420, GxEPD2_420::HEIGHT> display(GxEPD2_420(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// For Waveshare 7.5" Black & White screen (800x480 Version 2)
// GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT> display(GxEPD2_750_T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// For Waveshare 2.9" Black & White screen (296x128)
// GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(GxEPD2_290_T94(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// For Waveshare 2.7" Black & White screen (264x176)
// GxEPD2_BW<GxEPD2_270, GxEPD2_270::HEIGHT> display(GxEPD2_270(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));


// Allocate buffer to hold the downloaded raw 1-bit pixel bitmap
// Calculated as: (width * height) / 8 bytes.
// E.g., 400 * 300 / 8 = 15,000 bytes (15 KB), easily fits in ESP32's 320 KB RAM.
const int bufferSize = (displayWidth * displayHeight) / 8;
uint8_t* imageBuffer = nullptr;

// Symmetrical PROGMEM stream loop to load a local fallback diagnostic screen when offline
void loadLocalFallbackImage() {
  Serial.println("[Local Stream] Loading fallback diagnostic screen from flash memory...");
  
  // Symmetrical byte-by-byte streaming loop to generate/read pixel data
  // Similar to streaming a PROGMEM array: uint8_t byte = pgm_read_byte(&(myImage[i]))
  for (uint32_t i = 0; i < bufferSize; i++) {
    // Generate an elegant monochrome calibration checkerboard grid
    // Row and column calculations based on 1-bit packed bit alignment (8 pixels per byte)
    uint32_t pixelIndex = i * 8;
    uint32_t col = pixelIndex % displayWidth;
    uint32_t row = pixelIndex / displayWidth;
    
    // Create checkerboard blocks (64x64 blocks)
    if (((row / 64) + (col / 64)) % 2 == 0) {
      // Diagnostic crosshair lines in the block
      if (row % 16 == 0 || col % 16 == 0) {
        imageBuffer[i] = 0x00; // Paint Black gridlines
      } else {
        imageBuffer[i] = 0xAA; // Dithered diagnostic gray fill (10101010)
      }
    } else {
      if (row % 16 == 0 || col % 16 == 0) {
        imageBuffer[i] = 0x00; // Paint Black gridlines
      } else {
        imageBuffer[i] = 0xFF; // Paint White fill (11111111)
      }
    }
  }
  Serial.println("[Local Stream] Diagnostic fallback screen loaded.");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n--- TRMNL Pi ESP32 Client Awake ---");

  // CRITICAL SPI BUS PROTECTION:
  // Disables the onboard Flash chip (Pin 5) and SD Card (Pin 4) on the Waveshare E-Paper Shield
  // to protect the hardware SPI lines from package collision/corruption.
  pinMode(5, OUTPUT);
  digitalWrite(5, HIGH); // Pull Flash CS HIGH to disable it
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH); // Pull SD CS HIGH to disable it

  // Allocate memory for buffer
  imageBuffer = (uint8_t*)malloc(bufferSize);
  if (imageBuffer == nullptr) {
    Serial.println("[Error] Failed to allocate RAM for screen buffer!");
    goToSleep(fallbackSleepSeconds);
  }
  memset(imageBuffer, 0xFF, bufferSize); // Pre-fill with White (0xFF)

  // Connect to WiFi
  connectWiFi();

  // Download raw screen data
  int sleepSeconds = downloadRawDisplayBytes();

  // If download succeeded, push to screen. Otherwise, load local diagnostic grid!
  if (sleepSeconds > 0) {
    updateDisplay();
  } else {
    Serial.println("[Warning] Fetch failed. Loading local dithered fallback from Flash memory.");
    loadLocalFallbackImage();
    updateDisplay();
    sleepSeconds = fallbackSleepSeconds;
  }

  // Release RAM
  free(imageBuffer);

  // Enter deep sleep
  goToSleep(sleepSeconds);
}

void loop() {
  // Loop is unused as ESP32 wakes up from deep sleep, runs setup(), and sleeps again.
}

void connectWiFi() {
  Serial.printf("Connecting to WiFi SSID: %s\n", ssid);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP Address: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection timeout. Going to sleep...");
    goToSleep(60); // Retry in 1 minute
  }
}

int downloadRawDisplayBytes() {
  if (WiFi.status() != WL_CONNECTED) return -1;
  
  HTTPClient http;
  
  // Retrieve hardware MAC address dynamically
  String macAddress = WiFi.macAddress();
  Serial.printf("[WiFi] Fetching dynamic MAC address for TRMNL ID: %s\n", macAddress.c_str());
  
  // Construct request URL using dynamic MAC as the deviceId
  char url[256];
  snprintf(url, sizeof(url), "http://%s:%d/api/display/raw?device=%s&width=%d&height=%d", 
           serverIp, serverPort, macAddress.c_str(), displayWidth, displayHeight);
           
  Serial.printf("[HTTP] Fetching raw stream: %s\n", url);
  
  http.begin(url);
  
  // Register custom headers to collect from the server response
  const char* collectHeaders[] = {"X-Refresh-Rate", "X-Trmnl-Deep-Sleep"};
  http.collectHeaders(collectHeaders, 2);

  // Add official TRMNL telemetry headers
  http.addHeader("ID", macAddress);
  http.addHeader("Access-Token", macAddress); // MAC acts as private API token
  http.addHeader("FW-Version", "1.2.0");
  http.addHeader("RSSI", String(WiFi.RSSI()));
  
  // Symmetrical read of battery voltage (common divider is on GPIO 34 for ESP32)
  float voltage = 3.70;
  #ifdef ESP32
    int rawAnalog = analogRead(34);
    if (rawAnalog > 0) {
      voltage = (rawAnalog / 4095.0) * 2.0 * 3.3 * 1.1; // Standard scaling calculation
    }
  #endif
  
  // Format voltage string (e.g. "3.82V")
  char voltStr[16];
  dtostrf(voltage, 4, 2, voltStr);
  String batteryVoltage = String(voltStr) + "V";
  http.addHeader("Battery-Voltage", batteryVoltage);
  
  Serial.printf("[HTTP] Pinging server with telemetry: RSSI=%d dBm, Battery=%s\n", WiFi.RSSI(), batteryVoltage.c_str());

  int httpCode = http.GET();
  int sleepTime = fallbackSleepSeconds;
  
  if (httpCode == HTTP_CODE_OK) {
    int len = http.getSize();
    Serial.printf("[HTTP] Connected, stream size: %d bytes (Buffer expected: %d)\n", len, bufferSize);
    
    // Check if server returned custom sleep interval header
    if (http.hasHeader("X-Refresh-Rate")) {
      String rate = http.header("X-Refresh-Rate");
      sleepTime = rate.toInt();
      Serial.printf("[HTTP] Server set refresh rate: %d seconds\n", sleepTime);
    }
    
    WiFiClient* stream = http.getStreamPtr();
    int bytesRead = 0;
    
    // Read raw binary payload directly into our buffer
    while (http.connected() && bytesRead < bufferSize && (len > 0 || len == -1)) {
      size_t sizeAvail = stream->available();
      if (sizeAvail) {
        int readLen = min((int)sizeAvail, bufferSize - bytesRead);
        int c = stream->readBytes(imageBuffer + bytesRead, readLen);
        bytesRead += c;
      }
      delay(1);
    }
    
    Serial.printf("[HTTP] Downloaded %d bytes of raw screen pixel buffer.\n", bytesRead);
    http.end();
    
    if (bytesRead >= bufferSize) {
      return sleepTime;
    } else {
      Serial.println("[Error] Buffer stream truncated! Size mismatch.");
      return -1;
    }
  } else {
    Serial.printf("[HTTP] GET failed, server response code: %d\n", httpCode);
    http.end();
    return -1;
  }
}

void updateDisplay() {
  Serial.println("[Display] Initializing GxEPD2 SPI interface...");
  display.init(115200); // 115200 baud for SPI logging
  
  Serial.println("[Display] Pushing raw dithered horizontal bitmap page-by-page...");
  
  // GxEPD2 draw loop handles paged rendering to conserve ESP32 SRAM
  display.firstPage();
  do {
    // Draws standard monochrome bitmap horizontally aligned, white-is-high (0xFF fill).
    // GxEPD2 automatically diffuses coordinates
    display.drawBitmap(0, 0, imageBuffer, displayWidth, displayHeight, GxEPD_BLACK, GxEPD_WHITE);
  } while (display.nextPage());
  
  Serial.println("[Display] Powering down e-ink display SPI panel...");
  display.powerOff();
  Serial.println("[Display] Screen updated successfully!");
}

void goToSleep(int seconds) {
  Serial.printf("[Power] Entering Deep Sleep for %d seconds...\n", seconds);
  
  // Configure ESP32 deep sleep timer
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  
  // Power down WiFi radio
  WiFi.disconnect(true);
  
  // Sleep
  esp_deep_sleep_start();
}
