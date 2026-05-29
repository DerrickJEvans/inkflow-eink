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

1. Open `arduino_client.ino` in the Arduino IDE.
2. In the top **Configuration Settings** block, update:
   - `ssid` and `password` to match your home WiFi router credentials.
   - `serverIp` to match the local IP address of your Raspberry Pi (e.g. `192.168.1.50`).
   * *Note: The `deviceId` variable is removed! The sketch dynamically reads the board's hardwired MAC address at startup. This means you can flash the **exact same code** across multiple microcontrollers, and they will automatically auto-provision unique consoles on your server dashboard!*
   - `displayWidth` and `displayHeight` to match your screen resolution (e.g. `400` and `300` for a 4.2" screen).
3. Scroll down to the **GxEPD2 Display Driver Selection** section:
   - By default, the 4.2" Black & White display driver is active.
   - If you are using a different size display (e.g., 7.5" Version 2 or 2.9" Version 1), **comment out** the default line and **uncomment** the line matching your specific physical Waveshare panel model.
4. Connect your ESP32 to your computer via USB.
5. Select your ESP32 board in **Tools** -> **Board** (e.g. `ESP32 Dev Module` or `NodeMCU-32S`).
6. Click **Upload** to compile and flash.
7. Open the **Serial Monitor** set to **`115200 baud`** to observe connection logs, HTTP raw packet counts, and screen update cycles!

---

## 🔋 Battery Operations & Sleep Cycles

The sketch is built using ESP32's hardware **Deep Sleep** protocol:
- It wakes up from sleep.
- Boots and connects to WiFi in less than 3 seconds.
- Queries `/api/display/raw` on the server, downloading the tiny dithered 1-bit pixel array (only 15 KB for a 400x300 screen).
- **Symmetrical PROGMEM Stream Loop (Offline Fallback)**: If the WiFi connection fails or the server is offline, the client does not remain blank. Instead, it utilizes an optimized, memory-efficient PROGMEM streaming loop (`loadLocalFallbackImage()`) to read calibration checkerboard patterns and crosshairs out of Flash memory and draw them onto the screen. This serves as an immediate physical proof that your display wiring, controller, and SPI lines are 100% operational!
- Parses the server-provided `X-Refresh-Rate` header (or sleeps for 30 minutes by default).
- Drives SPI lines to paint the e-ink screen.
- Powers down the screen's SPI controller and puts the ESP32 into a deep sleep state where it draws practically **zero current (~10µA)**.
- This allows your custom e-ink dashboard to run on a single Lithium battery for **months**!

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
