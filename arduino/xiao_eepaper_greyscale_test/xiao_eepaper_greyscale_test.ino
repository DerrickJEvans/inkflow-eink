/*
  xiao_eepaper_greyscale_test.ino - 4-Level Grayscale Test for Seeed Studio EE04 Display Board
  
  Description:
    This sketch tests the gray levels, resolution, text contrast,
    and rendering capabilities of the 4.26-inch e-Paper (SSD1677, 800x480 resolution, 4-gray levels)
    on the Seeed Studio XIAO ePaper Display Board (B) EE04 (equipped with XIAO ESP32-S3).

  🔧 Grayscale Compilation:
    Ensure that "driver.h" defines `GRAY_LEVEL4`. This forces the Seeed_GFX library
    to compile with native 4-level grayscale support.

  📚 Required Libraries:
    * Seeed_GFX (https://github.com/Seeed-Studio/Seeed_GFX)
      Make sure it is cloned or downloaded into your Arduino libraries directory.
      The local "driver.h" automatically overrides the default screen/combo configurations.

  ⚙️ Arduino IDE settings:
    * Board: "XIAO_ESP32S3"
    * PSRAM: "OPI PSRAM" (Crucial for GFX display buffer allocation)
    * Partition Scheme: "Default with spiffs (3MB APP/1.5MB SPIFFS)"
    * USB CDC On Boot: "Enabled" (To observe Serial outputs immediately)
*/

#include "driver.h"
#include <TFT_eSPI.h>

// Note: TFT_GRAY_0 (Black), TFT_GRAY_1 (Dark Gray), TFT_GRAY_2 (Light Gray), and TFT_GRAY_3 (White)
// are automatically defined by the library when GRAY_LEVEL4 is defined in driver.h.

// Display Dimensions
#define DISPLAY_WIDTH  800
#define DISPLAY_HEIGHT 480

// Global display driver object (reads configuration from local driver.h internally)
EPaper epaper;

// Helper function to draw checkerboard/dithered patterns to inspect texture-blended grayscales
void drawDitheredBox(int x, int y, int w, int h, uint16_t c1, uint16_t c2) {
  for (int j = 0; j < h; j++) {
    for (int i = 0; i < w; i++) {
      if ((i + j) % 2 == 0) {
        epaper.drawPixel(x + i, y + j, c1);
      } else {
        epaper.drawPixel(x + i, y + j, c2);
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=======================================================");
  Serial.println("   Seeed Studio EE04 4.26\" e-Paper Grayscale Test");
  Serial.println("=======================================================");

  // 1. Initialize display driver
  Serial.println("[Display] Initializing Seeed_GFX driver...");
  epaper.begin();
  
  // 2. Clear display in 1-bit monochrome first
  Serial.println("[Display] Clearing screen with White (1-bit)...");
  epaper.fillScreen(TFT_WHITE);
  epaper.update();
  delay(500);

  // 3. Initialize 4-Grayscale mode
  Serial.println("[Display] Initializing 4-grayscale mode (GRAY_LEVEL4)...");
  epaper.initGrayMode(GRAY_LEVEL4);

  // 4. Draw test pattern
  Serial.println("[Test] Generating grayscale test pattern...");

  // --- Background Clear ---
  epaper.fillScreen(TFT_GRAY_3); // Fill whole frame with white

  // --- 1. Title Banner (y: 0 to 60) ---
  epaper.fillRect(0, 0, DISPLAY_WIDTH, 60, TFT_GRAY_0); // Solid black banner header
  
  // Header title (white text on black banner)
  epaper.setTextSize(2);
  epaper.setTextColor(TFT_GRAY_3, TFT_GRAY_0);
  epaper.setCursor(20, 12);
  epaper.print("XIAO EE04 4.26\" e-Paper Grayscale Test");
  
  // Header subtitle
  epaper.setTextSize(1);
  epaper.setCursor(20, 40);
  epaper.print("Seeed_GFX Library (TFT_eSPI) - GRAY_LEVEL4 Mode");

  // --- 2. Four Grayscale Columns (y: 60 to 360) ---
  int colWidth = DISPLAY_WIDTH / 4; // 800 / 4 = 200 pixels
  int colHeight = 300;
  int startY = 60;

  // Column 0: TFT_GRAY_0 (Black)
  epaper.fillRect(0, startY, colWidth, colHeight, TFT_GRAY_0);
  epaper.setTextSize(2);
  epaper.setTextColor(TFT_GRAY_3, TFT_GRAY_0);
  epaper.setCursor(40, startY + 100);
  epaper.println("TFT_GRAY_0");
  epaper.setCursor(70, startY + 130);
  epaper.println("BLACK");

  // Column 1: TFT_GRAY_1 (Dark Gray)
  epaper.fillRect(colWidth, startY, colWidth, colHeight, TFT_GRAY_1);
  epaper.setTextSize(2);
  epaper.setTextColor(TFT_GRAY_3, TFT_GRAY_1);
  epaper.setCursor(colWidth + 40, startY + 100);
  epaper.println("TFT_GRAY_1");
  epaper.setCursor(colWidth + 46, startY + 130);
  epaper.println("DARK GRAY");

  // Column 2: TFT_GRAY_2 (Light Gray)
  epaper.fillRect(colWidth * 2, startY, colWidth, colHeight, TFT_GRAY_2);
  epaper.setTextSize(2);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_2);
  epaper.setCursor(colWidth * 2 + 40, startY + 100);
  epaper.println("TFT_GRAY_2");
  epaper.setCursor(colWidth * 2 + 40, startY + 130);
  epaper.println("LIGHT GRAY");

  // Column 3: TFT_GRAY_3 (White)
  epaper.fillRect(colWidth * 3, startY, colWidth, colHeight, TFT_GRAY_3);
  epaper.setTextSize(2);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_3);
  epaper.setCursor(colWidth * 3 + 40, startY + 100);
  epaper.println("TFT_GRAY_3");
  epaper.setCursor(colWidth * 3 + 70, startY + 130);
  epaper.println("WHITE");
  // Draw column border for Column 3 so white matches white background cleanly
  epaper.drawRect(colWidth * 3, startY, colWidth, colHeight, TFT_GRAY_0);

  // --- 3. Bottom Panels Section (y: 360 to 480) ---
  // Thick divider line between middle columns and bottom panels
  epaper.drawFastHLine(0, 360, DISPLAY_WIDTH, TFT_GRAY_0);
  epaper.drawFastHLine(0, 361, DISPLAY_WIDTH, TFT_GRAY_0);

  // Panel A: Shades Horizontal Strips (x: 20 to 180)
  int panelA_x = 20;
  epaper.fillRect(panelA_x, 380, 160, 12, TFT_GRAY_0);
  epaper.fillRect(panelA_x, 395, 160, 12, TFT_GRAY_1);
  epaper.fillRect(panelA_x, 410, 160, 12, TFT_GRAY_2);
  epaper.fillRect(panelA_x, 425, 160, 12, TFT_GRAY_3);
  epaper.drawRect(panelA_x, 425, 160, 12, TFT_GRAY_0); // outline white stripe
  
  epaper.setTextSize(1);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_3);
  epaper.setCursor(panelA_x, 450);
  epaper.print("SOLID SHADES");

  // Panel B: Dithered Grades (x: 215 to 375)
  // Checkerboards of colors to test sub-pixel grayscale blending
  int panelB_x = 215;
  drawDitheredBox(panelB_x,      385, 35, 35, TFT_GRAY_0, TFT_GRAY_3); // Black/White
  drawDitheredBox(panelB_x + 40, 385, 35, 35, TFT_GRAY_1, TFT_GRAY_2); // Dark/Light Gray
  drawDitheredBox(panelB_x + 80, 385, 35, 35, TFT_GRAY_0, TFT_GRAY_1); // Black/Dark Gray
  drawDitheredBox(panelB_x + 120,385, 35, 35, TFT_GRAY_3, TFT_GRAY_2); // White/Light Gray
  epaper.drawRect(panelB_x + 120, 385, 35, 35, TFT_GRAY_0);            // Outline light block
  
  epaper.setTextSize(1);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_3);
  epaper.setCursor(panelB_x, 450);
  epaper.print("DITHERED BLENDS");

  // Panel C: Line Contrast / Resolution (x: 410 to 570)
  int panelC_x = 410;
  // Draw diagonal lines in various shades to inspect rendering sharpness
  epaper.drawLine(panelC_x, 380, panelC_x + 90, 440, TFT_GRAY_0);
  epaper.drawLine(panelC_x + 20, 380, panelC_x + 110, 440, TFT_GRAY_1);
  epaper.drawLine(panelC_x + 40, 380, panelC_x + 130, 440, TFT_GRAY_2);
  
  // Draw horizontal lines of different thickness
  epaper.drawFastHLine(panelC_x + 100, 390, 60, TFT_GRAY_0); // 1px
  epaper.fillRect(panelC_x + 100, 405, 60, 2, TFT_GRAY_0);    // 2px
  epaper.fillRect(panelC_x + 100, 420, 60, 4, TFT_GRAY_1);    // 4px

  epaper.setTextSize(1);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_3);
  epaper.setCursor(panelC_x, 450);
  epaper.print("LINE RESOLUTION");

  // Panel D: Concentric Circles / Shapes (x: 600 to 780)
  int panelD_x = 610;
  int circle_x = 690;
  int circle_y = 410;
  epaper.drawCircle(circle_x, circle_y, 35, TFT_GRAY_0); // Outer Black Circle Outline
  epaper.fillCircle(circle_x, circle_y, 26, TFT_GRAY_1); // Dark Gray Fill
  epaper.fillCircle(circle_x, circle_y, 17, TFT_GRAY_2); // Light Gray Fill
  epaper.fillCircle(circle_x, circle_y, 8, TFT_GRAY_0);  // Innermost Black Solid

  epaper.setTextSize(1);
  epaper.setTextColor(TFT_GRAY_0, TFT_GRAY_3);
  epaper.setCursor(panelD_x, 450);
  epaper.print("CONCENTRIC GRADING");

  // --- 5. Commit Frame buffer to Panel ---
  Serial.println("[Display] Pushing framebuffer to panel (Performing full refresh)...");
  epaper.update();
  Serial.println("[Display] Update completed successfully!");
  Serial.println("\n=======================================================");
  Serial.println(" Grayscale test finished. Board is now waiting.");
  Serial.println(" Press the RESET button on the board to run test again.");
  Serial.println("=======================================================");
}

void loop() {
  // Stay idle to keep the test pattern on the screen.
  delay(1000);
}
