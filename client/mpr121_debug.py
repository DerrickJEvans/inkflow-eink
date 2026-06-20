#!/usr/bin/env python3
# mpr121_debug.py - Utility to test and debug MPR121 capacitive touch inputs
import time
import sys

print("====================================================")
print("     📟 MPR121 Capacitive Touch Debugger 📟")
print("====================================================")

try:
    import board
    import busio
    import adafruit_mpr121
except ImportError as e:
    print(f"❌ Error: Required libraries not found: {e}")
    print("Please install them using:")
    print("  pip3 install adafruit-circuitpython-mpr121 --break-system-packages")
    sys.exit(1)

try:
    print("🔌 Initializing I2C bus...")
    i2c = busio.I2C(board.SCL, board.SDA)
    print("🔍 Initializing MPR121 on I2C address 0x5A (default)...")
    mpr121 = adafruit_mpr121.MPR121(i2c)
    # Set thresholds for all pins to increase sensitivity (7 for touch, 3 for release)
    for i in range(12):
        mpr121[i].threshold = 7
        mpr121[i].release_threshold = 3
    print("✅ MPR121 initialized successfully!")

except Exception as e:
    print(f"❌ Error initializing MPR121: {e}")
    print("\nTroubleshooting tips:")
    print("1. Verify I2C is enabled on the Raspberry Pi: run 'sudo raspi-config', Interfacing Options -> I2C -> Yes")
    print("2. Verify physical connections (GND, 3.3V, SDA, SCL)")
    print("3. Check if the device is visible on I2C bus: run 'sudo i2cdetect -y 1'")
    sys.exit(1)

print("\n📡 Listening for touches on pins 0-11... (Press Ctrl+C to exit)\n")

# Store previous state of each pin to only print changes
prev_state = [False] * 12

try:
    while True:
        for pin in range(12):
            try:
                state = mpr121[pin].value
                if state != prev_state[pin]:
                    if state:
                        print(f"[{time.strftime('%H:%M:%S')}] 🔴 Pin {pin} TOUCHED")
                    else:
                        print(f"[{time.strftime('%H:%M:%S')}] 🟢 Pin {pin} RELEASED")
                    prev_state[pin] = state
            except Exception as e:
                print(f"Error reading pin {pin}: {e}")
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\n👋 Debugging terminated.")
