# E-Ink Dashboard Arduino C++ Clients

This subfolder houses highly optimized **Arduino C++ clients** designed to turn cheap wireless microcontrollers connected to Waveshare E-Paper displays into low-power wireless status consoles:

### 1. ⚡ Option A: ESP32 Client (`arduino_client/`)
* **Features**: Uses the GxEPD2 library for highly compatible, paged graphics rendering.
* **Power Optimization**: Leverages the ESP32's native deep sleep mode to run on battery power for months!
* **Memory usage**: Buffers pixels in RAM, then pushes them to GxEPD2.

### 2. 🎛️ Option B: Arduino UNO R4 WiFi Client (`arduino_r4_client/`)
* **Features**: Uses a custom **Zero-Buffer Direct SPI Streaming** pipeline that bypasses library buffering. 
* **RAM Optimization**: Streams incoming raw image bytes directly from the network socket (`client.read()`) to the screen controller (`epd.SendData()`) over SPI. Avoids RAM buffer allocations entirely, allowing the 32 KB SRAM UNO R4 to drive large 800x480 displays!
* **Hardware Controls**: Integrates custom Dip switches and voltage configurations on the Waveshare E-Paper Shield (B).

---

## 🛠️ Required Arduino Libraries

For the **ESP32 Client**, open the Arduino IDE, go to **Tools** -> **Manage Libraries...**, and install:
1. **`GxEPD2`** by Jean-Marc Zingg
2. **`Adafruit GFX Library`** by Adafruit

For the **Arduino UNO R4 WiFi Client**, no extra libraries are required. Simply make sure you have the official `WiFiS3` board package installed in the Arduino IDE Board Manager!

---

## 🔌 Option A: ESP32 Hardware SPI Wiring Diagram

Connect your ESP32 board to the Waveshare E-Paper Display (or ESP32 driver board HAT) according to the following wiring map:

| E-Paper Hat Cable | Label | Function | ESP32 GPIO Pin | Description |
|:---|:---|:---|:---|:---|
| **VCC** (Red) | 3.3V | Power Supply | **3.3V** | Power input (do not connect to 5V!) |
| **GND** (Black) | GND | Ground | **GND** | System ground |
| **DIN** (Blue) | MOSI | SPI Data Input | **GPIO 23** | Hardware SPI MOSI (Master Out Slave In) |
| **CLK** (Yellow) | SCK | SPI Clock Input | **GPIO 18** | Hardware SPI SCK (Serial Clock) |
| **CS** (Orange) | CS | Chip Select | **GPIO 15** | Device SPI enable line (active low) — Remapped to avoid GPIO 5 flash conflicts |
| **DC** (Green) | D/C | Data / Command | **GPIO 17** | Toggles register inputs (Data vs. Command) |
| **RST** (Grey) | RST | Board Reset | **GPIO 16** | Resets physical screen |
| **BUSY** (White) | BUSY | Busy Indicator | **GPIO 4** | Signals screen draw state (high when painting) |

⚠️ **CRITICAL WAVESHARE SHIELD CONFLICT WARNING**:
On the official **Waveshare Arduino E-Paper Shield or HAT**, there is an onboard serial SPI Flash chip hardwired to **GPIO 5**, and an SD Card slot CS hardwired to **GPIO 4**. 
* If you leave these pins floating, they will respond to SPI transfers during e-paper rendering, causing severe packet corruption and pixel skews!
* The client code explicitly configures **GPIO 5** and **GPIO 4** as outputs and pulls them `HIGH` at boot to shut down their SPI interfaces.
* Because the Flash CS is hardwired to **GPIO 5**, you **MUST** wire the E-Paper's physical Chip Select (CS) pin to **GPIO 15** (or another unused GPIO pin) and configure `#define EPD_CS 15` inside the `.ino` file!
* *Note: If you are using the dedicated Waveshare **ESP32 E-Paper Driver Board** (which does not have the onboard Flash conflict), you can connect the E-Paper CS to GPIO 5 and configure `#define EPD_CS 5`.*

---

## 🚀 Setup & Flashing Instructions

### ⚡ ESP32 Setup Wizard (Zero-Configuration Flashing!)
The ESP32 E-Ink client features a premium **E-Ink Setup Wizard & Captive Portal WiFi Manager** out of the box! You do **not** need to hardcode your WiFi SSID, passwords, or server addresses inside the code before flashing.

1. **Configure Screen Size**:
   * Open `config.h` in the `arduino_client/` folder.
   * By default, the 4.2" screen is uncommented. If you use a different size (e.g. 7.5", 2.9", or 2.7"), simply comment out the 4.2" line and uncomment your exact screen selection.
2. **Flash the Code**:
   * Connect your ESP32 board to your computer via USB.
   * Open `arduino_client.ino` in the Arduino IDE, select your ESP32 board and port under **Tools**, and click **Upload**!
3. **Connect to Setup Portal**:
   * On first boot (or if it fails to connect to any stored networks), the E-Ink screen will automatically refresh to show the **InkFlow Setup Wizard** instructions and spawn a password-free WiFi network: **`InkFlow-Setup`**.
   * Connect your mobile phone or computer to the **`InkFlow-Setup`** WiFi network.
   * A captive portal settings page will slide open automatically. If it doesn't, open a browser and go to: **`http://192.168.4.1`**.
4. **Submit Configurations**:
   * The setup page will automatically display a **Scanned WiFi Networks** dropdown containing all locally scanned SSIDs.
   * Select your Wi-Fi, enter your password, input the **InkFlow Server Host/IP** (your Raspberry Pi's local address, e.g. `192.168.1.122`), and customize your screen name.
   * Click **Save Settings & Connect**! The ESP32 will store these configurations securely in non-volatile flash memory, connect to your router, fetch your E-Ink display raw data, and enter its low-power refresh cycles automatically.

5. **Serial Monitoring**:
   * Open the **Serial Monitor** set to **`115200 baud`** to observe connection logs, web portal requests, raw packet counts, and screen update cycles!

---

## 🔋 Sleep & Battery Mechanics: ESP32 vs. UNO R4 WiFi

The two Arduino clients handle power management and refresh cycles differently based on their physical hardware architectures:

### ⚡ ESP32 Native Hardware Deep Sleep (`arduino_client/`)
The ESP32 sketch is built using the controller's native hardware **Deep Sleep** protocol:
* **Execution flow**: It wakes up from deep sleep, boots, and establishes a WiFi connection in less than 3 seconds.
* **Data Fetching**: Queries `/api/display/raw` on the server to download the tiny dithered 1-bit pixel array (e.g. only 15 KB for a 400x300 screen).
* **Symmetrical PROGMEM Stream Loop (Offline Fallback)**: If the WiFi connection fails or the server is offline, the client does not remain blank. Instead, it utilizes an optimized, memory-efficient PROGMEM streaming loop (`loadLocalFallbackImage()`) to read calibration checkerboard patterns and crosshairs out of Flash memory and draw them onto the screen. This serves as an immediate physical proof that your display wiring, controller, and SPI lines are 100% operational!
* **Power Down**: After pushing pixels to the screen, it powers down the display's SPI controller and puts the ESP32 chip into a native deep sleep state, drawing practically **zero current (~10µA)**.
* **Reboot Cycle**: When the deep sleep timer expires, the chip performs a cold boot and restarts the program. This native power-saving mode allows the ESP32 client to run on a single Lithium battery for **months**!

### 🎛️ Arduino UNO R4 WiFi Deep Sleep Simulation (`arduino_r4_client/`)
Because the Arduino UNO R4 WiFi lacks a native, low-power deep sleep mode that preserves socket/SPI states without complex external circuitry, it **simulates deep sleep in software**:
* **Execution flow**: After performing a zero-buffer direct SPI stream to paint the screen, it shuts down the onboard WiFi radio (`WiFi.end()`) to drastically reduce board power draw.
* **Deep Wait Loop**: It enters a lightweight delay loop `delay(1000)` running once per second for the duration of the required refresh interval (supplied by the server's `X-Refresh-Rate` header or defaulting to 1800 seconds).
* **Hardware-Level Software Reset**: Once the delay loop completes, it executes a hardware-level software reset (`NVIC_SystemReset()`). This completely reboots the UNO R4 microcontroller, clearing all RAM allocations, restarting the network stack, and running the setup routine completely fresh.
* **Benefits**: This simulation ensures the client is extremely stable, completely prevents memory fragmentation or leakages over long-term operations, and avoids keeping the power-hungry WiFi radio active during idle times.

---

## 🎛️ Option B: Arduino UNO R4 WiFi & Waveshare Shield Setup

The **Arduino UNO R4 WiFi Client** (`arduino_r4_client/`) is specifically designed for a low-RAM, direct-streaming setup. It streams E-Ink images directly from the TCP socket buffer to the display over SPI, avoiding memory allocations entirely.

### 🔌 Physical Board & Switch Configurations
To use this sketch successfully on the **Waveshare E-Paper Shield (B)** mounted on an **Arduino UNO R4 WiFi**, you must configure the physical board switches exactly as follows:

| Physical Switch / Slider | Target Position | Purpose / Description |
|:---|:---|:---|
| **D11 / D12 / D13 DIP Switches** | **OFF** | Completely disconnects these pins to protect Arduino R4 WiFi SPI lines |
| **SPI Config Slider** | **ICSP** | Routes SPI hardware lines (MOSI/MISO/SCK) through the 6-pin ICSP header |
| **VCC Voltage Slider** | **5V** | Powers the shield logic converters cleanly at 5V |
| **Interface (0 / 1)** | **0** | Selects **4-Wire SPI** communication interface mode |
| **Display Type (A / B)** | **A** | Provides the cleanest signal path for your specific display panel |

### 🚀 Setup & Flashing Instructions
1. Mount the **Waveshare E-Paper Shield (B)** firmly onto the Arduino UNO R4 WiFi board header.
2. Open `arduino_r4_client.ino` inside the Arduino IDE.
3. In the top **Configuration Settings** block, update:
   - `ssid` and `password` with your home WiFi router credentials.
   - `serverIp` with the local IP address of your Raspberry Pi (e.g. `192.168.1.122`).
   * *Note: The `deviceId` parameter is dynamically resolved from the board's hardware MAC address at boot, eliminating the need to edit unique IDs for multiple screens!*
4. Select **Arduino UNO R4 WiFi** in the Arduino IDE **Tools** -> **Board** menu.
5. Click **Upload** to compile and flash the direct zero-buffer streaming code!
6. Open the **Serial Monitor** at **`115200 baud`** to observe raw HTTP packet counts, real-time stream state transitions, auto-padding safety sequences, and hardware drawing cycles.
