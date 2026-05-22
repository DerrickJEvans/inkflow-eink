# Arduino ESP32 Client — Waveshare E-Paper HAT Wiring Guide

This subfolder houses the highly optimized C++ Arduino client (`arduino_client.ino`) which enables an **ESP32** microcontroller coupled with a **Waveshare E-Paper screen or HAT** (connected via SPI) to act as a low-power wireless dashboard receiver.

---

## 🛠️ Required Arduino Libraries

Open the Arduino IDE, go to **Tools** -> **Manage Libraries...**, and install the following two libraries:
1. **`GxEPD2`** by Jean-Marc Zingg (The standard library for Waveshare e-Paper SPI displays, supporting paged rendering to conserve RAM).
2. **`Adafruit GFX Library`** by Adafruit (Required core graphics dependency).

---

## 🔌 Hardware SPI Wiring Diagram

Connect your ESP32 board to the Waveshare E-Paper Display (or ESP32 driver board HAT) according to the following wiring map:

| E-Paper Hat Cable | Label | Function | ESP32 GPIO Pin | Description |
|:---|:---|:---|:---|:---|
| **VCC** (Red) | 3.3V | Power Supply | **3.3V** | Power input (do not connect to 5V!) |
| **GND** (Black) | GND | Ground | **GND** | System ground |
| **DIN** (Blue) | MOSI | SPI Data Input | **GPIO 23** | Hardware SPI MOSI (Master Out Slave In) |
| **CLK** (Yellow) | SCK | SPI Clock Input | **GPIO 18** | Hardware SPI SCK (Serial Clock) |
| **CS** (Orange) | CS | Chip Select | **GPIO 5** | Device SPI enable line (active low) |
| **DC** (Green) | D/C | Data / Command | **GPIO 17** | Toggles register inputs (Data vs. Command) |
| **RST** (Grey) | RST | Board Reset | **GPIO 16** | Resets physical screen |
| **BUSY** (White) | BUSY | Busy Indicator | **GPIO 4** | Signals screen draw state (high when painting) |

*Note: If you are using the official Waveshare **ESP32 E-Paper Driver Board**, these pin definitions are pre-wired. Simply select `ESP32 Dev Module` in the Arduino IDE and flash the code directly.*

---

## 🚀 Setup & Flashing Instructions

1. Open `arduino_client.ino` in the Arduino IDE.
2. In the top **Configuration Settings** block, update:
   - `ssid` and `password` to match your home WiFi credentials.
   - `serverIp` to match the local IP address of your Raspberry Pi (e.g. `192.168.1.50`).
   - `deviceId` to give your screen a custom name (e.g. `hallway_clock`).
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
- Parses the server-provided `X-Refresh-Rate` header (or sleeps for 30 minutes by default).
- Drives SPI lines to paint the e-ink screen.
- Powers down the screen's SPI controller and puts the ESP32 into a deep sleep state where it draws practically **zero current (~10µA)**.
- This allows your custom e-ink dashboard to run on a single Lithium battery for **months**!
