# E-Ink Dashboard Arduino C++ Clients

This subfolder houses highly optimized **Arduino C++ clients** designed to turn cheap wireless microcontrollers connected to Waveshare E-Paper displays into low-power wireless status consoles:

### 1. ⚡ Option A: Seeed Studio XIAO ePaper Client (`xiao_eepaper_client/`)
* **Features**: Uses the official `Seeed_GFX` library to drive the large 4.26-inch 4-gray grayscale E-paper screen.
* **Power Optimization**: Leverages the XIAO ESP32-S3's native deep sleep mode to run on batteries for months!
* **Grayscale Buffering**: Buffers 4-level grayscale layouts (192KB sprite buffer) inside the board's external OPI PSRAM to keep the internal SRAM clean for the network and WiFi stack.

### 2. 🎛️ Option B: Arduino UNO R4 WiFi Client (`uno_r4_client/`)
* **Features**: Uses a custom **Zero-Buffer Direct SPI Streaming** pipeline that bypasses library buffering. 
* **RAM Optimization**: Streams incoming raw image bytes directly from the network socket (`client.read()`) to the screen controller (`epd.SendData()`) over SPI. Avoids RAM buffer allocations entirely, allowing the 32 KB SRAM UNO R4 to drive large 800x480 displays!
* **Hardware Controls**: Integrates custom Dip switches and voltage configurations on the Waveshare E-Paper Shield (B).
* **E-Ink Diagnostics & Progress**: Integrates a programmatic, zero-buffer direct-SPI feedback engine using an embedded flash-based font (`font8x8.h`) to render real-time WiFi scanning status, setup AP instructions, and detailed diagnostic error screens (WiFi Failed, Server Offline, HTTP Timeout) directly on the screen without needing a serial monitor!

---

## 🛠️ Required Arduino Libraries & Board Packages

For the **Seeed Studio XIAO ePaper Client**, you must:
1. Install the official `Seeed_GFX` library by cloning or downloading [Seeed_GFX (GitHub)](https://github.com/Seeed-Studio/Seeed_GFX) into your Arduino `libraries` folder.
2. In the Arduino Board Manager, install the `esp32` board package by Espressif Systems.

For the **Arduino UNO R4 WiFi Client**, no extra libraries are required. Simply make sure you have the official `WiFiS3` board package installed in the Arduino IDE Board Manager!

---

---

---

## 🚀 Setup & Flashing Instructions

### ⚡ Seeed Studio XIAO ePaper Setup Wizard (Zero-Configuration Flashing!)
The XIAO ePaper client features a premium **E-Ink Setup Wizard & Captive Portal WiFi Manager** out of the box! You do **not** need to hardcode your WiFi SSID, passwords, or server addresses inside the code before flashing.

1. **Board Settings**:
   * Configure the Arduino IDE for the XIAO ESP32-S3 as detailed in the [`xiao_eepaper_client/README.md`](xiao_eepaper_client/README.md) file (enable **OPI PSRAM** and select partition scheme with SPIFFS/LittleFS).
2. **Flash the Code**:
   * Connect your Seeed Studio XIAO board to your computer via USB.
   * Open `xiao_eepaper_client.ino` in the Arduino IDE, select the `XIAO_ESP32S3` board and port, and click **Upload**!
3. **Connect to Setup Portal**:
   * On first boot (or if it fails to connect to any stored networks), the E-Ink screen will automatically refresh to show the **InkFlow Setup Wizard** instructions and a QR code, spawning a secured WiFi network: **`InkFlow-Setup`** (password: `12345678`).
   * Connect your mobile phone or computer to the **`InkFlow-Setup`** WiFi network, and a captive portal settings page will slide open automatically (or navigate to `http://192.168.4.1`).
4. **Submit Configurations**:
   * Select your Wi-Fi, enter your password, input the **InkFlow Server Host/IP** (your Raspberry Pi's local address, e.g. `192.168.1.122`), and customize your screen name.
   * Click **Save Settings**! The board will store these configurations securely in non-volatile flash memory, connect to your router, fetch your E-Ink display raw data, and enter its low-power refresh cycles automatically.

5. **Serial Monitoring**:
   * Open the **Serial Monitor** set to **`115200 baud`** to observe connection logs, web portal requests, raw packet counts, and screen update cycles!

> [!TIP]
> **Developer Reset Mode**: If your board connects automatically on boot using default credentials, but you want to test or force-reset configurations to open the web setup portal manually, simply open your **Serial Monitor** set to **`115200 baud`**, press the physical **RESET button** on your XIAO board to reboot, and **type the `r` key** into the Serial input box and press Enter within the first 10 seconds of boot. The client will instantly wipe all saved preferences and launch the captive portal AP!

---

## 🔋 Sleep & Battery Mechanics: XIAO vs. UNO R4 WiFi

The C++ clients handle power management and refresh cycles differently based on their physical hardware architectures:

### ⚡ XIAO ESP32-S3 Native Hardware Deep Sleep (`xiao_eepaper_client/`)
The Seeed Studio XIAO sketch is built using the microcontroller's native hardware **Deep Sleep** protocol:
* **Execution flow**: It wakes up from deep sleep, boots, and establishes a WiFi connection in less than 3 seconds.
* **Data Fetching**: Queries `/api/display/raw` on the server to download the dithered 4-level grayscale pixel array.
* **Power Down**: After pushing pixels to the screen, it powers down the display and puts the board into a native deep sleep state, drawing practically **zero current (~10µA)**.
* **Reboot Cycle**: When the deep sleep timer expires, the chip performs a cold boot and restarts the program. This native power-saving mode allows the XIAO client to run on a battery for **months**!

### 🎛️ Arduino UNO R4 WiFi Deep Sleep Simulation (`uno_r4_client/`)
Because the Arduino UNO R4 WiFi lacks a native, low-power deep sleep mode that preserves socket/SPI states without complex external circuitry, it **simulates deep sleep in software**:
* **Execution flow**: After performing a zero-buffer direct SPI stream to paint the screen, it shuts down the onboard WiFi radio (`WiFi.end()`) to drastically reduce board power draw.
* **Deep Wait Loop**: It enters a lightweight delay loop `delay(1000)` running once per second for the duration of the required refresh interval (supplied by the server's `X-Refresh-Rate` header or defaulting to 1800 seconds).
* **Hardware-Level Software Reset**: Once the delay loop completes, it executes a hardware-level software reset (`NVIC_SystemReset()`). This completely reboots the UNO R4 microcontroller, clearing all RAM allocations, restarting the network stack, and running the setup routine completely fresh.
* **Benefits**: This simulation ensures the client is extremely stable, completely prevents memory fragmentation or leakages over long-term operations, and avoids keeping the power-hungry WiFi radio active during idle times.

---

## 🎛️ Option B: Arduino UNO R4 WiFi & Waveshare Shield Setup

The **Arduino UNO R4 WiFi Client** (`uno_r4_client/`) is specifically designed for a low-RAM, direct-streaming setup. It streams E-Ink images directly from the TCP socket buffer to the display over SPI, avoiding memory allocations entirely.

### 🔌 Physical Board & Switch Configurations
To use this sketch successfully on the **Waveshare E-Paper Shield (B)** mounted on an **Arduino UNO R4 WiFi**, you must configure the physical board switches exactly as follows:

| Physical Switch / Slider | Target Position | Purpose / Description |
|:---|:---|:---|
| **D11 / D12 / D13 DIP Switches** | **OFF** | Completely disconnects these pins to protect Arduino R4 WiFi SPI lines |
| **SPI Config Slider** | **ICSP** | Routes SPI hardware lines (MOSI/MISO/SCK) through the 6-pin ICSP header |
| **VCC Voltage Slider** | **5V** | Powers the shield logic converters cleanly at 5V |
| **Interface (0 / 1)** | **0** | Selects **4-Wire SPI** communication interface mode |
| **Display Type (A / B)** | **A** | Provides the cleanest signal path for your specific display panel |

### 🚀 Setup & Flashing Instructions (Zero-Configuration Setup!)
The UNO R4 WiFi client features an integrated **Web Setup Portal & EEPROM Wifi Manager** out of the box! You do **not** need to hardcode WiFi credentials or server IPs before flashing.

1. **Physical Mount**: Mount the **Waveshare E-Paper Shield (B)** firmly onto the Arduino UNO R4 WiFi board headers and configure the switches as detailed in the matrix above.
2. **Flash the Code**: 
   * Open `arduino_r4_client.ino` in the Arduino IDE.
   * Select **Arduino UNO R4 WiFi** in the **Tools** -> **Board** menu, select your port, and click **Upload**!
3. **Connect to Setup AP**:
   * On first boot (or if connection to stored credentials fails), the R4 WiFi will instantly flash the E-Ink panel to display **`WiFi Scan... Scanning local SSIDs`** while it runs its environment survey.
   * Once the survey completes, the R4 launches a WPA2-secured setup AP named: **`InkFlow-R4-Setup`** and updates the E-Ink display to show step-by-step connection instructions and its hardware MAC address.
   * Connect your mobile phone or computer to the **`InkFlow-R4-Setup`** WiFi network using the password **`12345678`**.
   * The captive setup portal will pop open automatically. If it doesn't, open a web browser and navigate to: **`http://192.168.4.1`**.
4. **Submit Configurations**:
   * The configuration page will automatically display a **Select Scanned Network** dropdown containing all locally scanned Wi-Fi SSIDs with signal strengths. Select your network (or type one manually), enter the password, review the pre-filled server target (defaults to `inkflow.local`), and click **Save Settings & Connect**!
   * The R4 will save settings securely to its onboard EEPROM memory, display a success page, perform a hardware-level software reset to clear RAM, connect to your router, and stream your dithered E-Ink images directly to the screen!
5. **Visual Diagnostics**:
   * If a connection or server fetch fails, the R4 will immediately render a beautiful, highly detailed **Connection Error / Diagnostics** screen directly on the physical E-Ink panel showing what failed (e.g. *WiFi Connection Failed*, *Server Offline*, *HTTP Timeout*, or *Display Init Failed*) and the specific settings attempted, allowing you to troubleshoot completely offline without any serial cable!
6. **Serial Monitor**:
   * You can still open the **Serial Monitor** set to **`115200 baud`** to observe raw HTTP packet counts, AP request handling, and hardware drawing cycles.

> [!TIP]
> **Developer Reset Mode (Serial)**: If your R4 connects automatically on boot using default credentials, but you want to test or force-reset configurations to open the web setup portal manually, simply open your **Serial Monitor** set to **`115200 baud`**, press the physical **RESET button** on your UNO R4 board to reboot, and **type the `r` key** into the Serial input box and press Enter within the first 10 seconds of boot. The client will instantly wipe the EEPROM database and restart the Setup AP Portal!

### 🎛️ Physical Button Integration (D2, D3, A1, A2)
The board supports physical button control inputs mapped to the following pins:
* **D2 (PIN_PREV / IRQ1)**: Wakes the board from sleep and instantly fetches the **previous** carousel slide (`action=prev`).
* **D3 (PIN_NEXT / IRQ0)**: Wakes the board from sleep and instantly fetches the **next** carousel slide (`action=next`).
* **A1 (PIN_DIAG / IRQ6)**: Wakes the board from sleep and displays a detailed **Diagnostics Report overlay** directly on the E-Ink panel for 10 seconds before returning to Software Standby.
* **A2 (PIN_AP / IRQ7)**: Wakes the board from sleep and forces the launch of the **Setup Wizard AP** to reconfigure WiFi and Server IP settings.

