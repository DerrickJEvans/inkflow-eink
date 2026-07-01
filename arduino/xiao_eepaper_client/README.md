# Seeed Studio XIAO ePaper Display Board (B) EE04 Client

This project is a high-performance, low-power Arduino client for the **Seeed Studio XIAO ePaper Display Board (B) EE04** equipped with the **4.26-inch SSD1677 4-gray-levels e-paper display panel (KEGM042691M01)**. 

It is designed to fetch, cache, and render dithered 4-level grayscale pixel buffers (4bpp, 192KB) from the InkFlow Status Console server.

---

## 🛠️ Required Hardware & Specifications
* **Development Board**: Seeed Studio XIAO ESP32-S3 Plus (Espressif ESP32-S3R8 SoC)
* **Onboard Flash**: 8 MB
* **Onboard PSRAM**: 8 MB (OPI Interface)
* **Display Panel**: 4.26-inch ePaper (SSD1677, 800x480 resolution, 4 grey levels)
* **Buttons**: 3 User GPIO Buttons, 1 RESET Button

---

## 📚 Required Libraries

This project uses the official Seeed Studio GFX library. You must install it manually:
1. Download or clone the library repository from GitHub:  
   👉 **[Seeed-Studio/Seeed_GFX (GitHub)](https://github.com/Seeed-Studio/Seeed_GFX)**
2. Place the folder in your Arduino libraries directory (usually located at `Documents/Arduino/libraries/Seeed_GFX`).

*Note: The local configuration header `driver.h` included in this project automatically overrides the library's defaults to select `BOARD_SCREEN_COMBO 506` (4.26 inch SSD1677) and `USE_XIAO_EPAPER_DISPLAY_BOARD_EE04`.*

---

## ⚙️ Arduino IDE Configuration Settings

To ensure the sketch compiles and runs stably without memory depletion or cache mount failures, configure the following settings under **Tools** in the Arduino IDE:

| Setting | Value to Select | Rationale |
| :--- | :--- | :--- |
| **Board** | `XIAO_ESP32S3` | Selects the target Tensilica Xtensa LX7 dual-core processor core. |
| **PSRAM** | **`OPI PSRAM`** | **Crucial.** Enables the 8MB external RAM. `Seeed_GFX` will automatically allocate the 192KB sprite buffer here, keeping internal SRAM free for WiFi and HTTP stacks. |
| **Partition Scheme** | **`Default with spiffs (3MB APP/1.5MB SPIFFS)`** | **Crucial.** Allocates the flash filesystem partition, allowing the `LittleFS` cache manager to mount successfully and store offline slide frames. |
| **USB CDC On Boot** | `Enabled` | Ensures you see debugging and setup prompts immediately in the Serial Monitor on power-up. |

---

## 🎮 Board Interface & Operation

### Onboard Buttons (Active-Low)
The three user buttons on the EE04 board are mapped as follows:
* **KEY0 (GPIO 2)**: Wakes the board and requests the **Previous** carousel slide (`action=prev`).
* **KEY1 (GPIO 3)**: Wakes the board and requests the **Next** carousel slide (`action=next`).
* **KEY2 (GPIO 5)**: Wakes the board and performs diagnostics:
  * **Short Press**: Renders a **Diagnostics Report Overlay** (local IP, WiFi signal dBm, server target IP config) for 8 seconds, then sleeps.
  * **Hold for 3 Seconds**: Wipes the stored WiFi credentials/server IP configuration and launches the **Captive Setup AP**.

### Wiping Settings via Serial Monitor
If you have the board plugged into your PC via USB:
1. Open the Serial Monitor at **`115200 baud`**.
2. Press the physical **RESET** button on the XIAO board.
3. You will see a 10-second prompt: *`Press 'r' in Serial Monitor within 10 seconds to force clear settings...`*
4. Type **`r`** (or **`R`**) in the input bar and press Enter to reset configurations and launch the Web Setup Wizard.

---

## 🌐 Web Setup Portal
If no WiFi settings are stored (e.g., first boot or after a manual reset), the display automatically starts a WiFi Access Point:
1. Connect your computer or phone to the **`InkFlow-Setup`** WiFi network (Password: `12345678` or scan the WiFi QR code drawn on the screen).
2. Open a web browser and go to **`http://192.168.4.1`** (or scan the URL QR code on the screen).
3. Select your local WiFi network, enter your password, and specify your InkFlow Server IP and Port (e.g. `192.168.1.100` and `5000`).
4. Click **Save Settings**. The board will reboot, download the 4-level grayscale stream, display it, and enter ultra-low power deep sleep.
