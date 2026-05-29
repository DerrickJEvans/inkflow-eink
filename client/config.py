# config.py - Configuration settings for the Python E-Ink Client
import os

# Server Settings
# Change to your Pi server's IP address (e.g., '192.168.1.100')
SERVER_IP = os.environ.get('TRMNL_SERVER_IP', '192.168.1.122')
SERVER_PORT = os.environ.get('TRMNL_SERVER_PORT', '5000')

# ==============================================================================
#                                DEVICE DETAILS
# ==============================================================================

# 1. Dynamic Device Naming
# Setting this automatically updates your screen name in the Control Center!
DEVICE_NAME = 'Living Room Pi'

# 2. Dynamic Device ID (MAC Address)
# Set to 'dynamic_mac' or leave empty to dynamically read your network MAC address at boot!
DEVICE_ID = 'dynamic_mac'

# 3. E-Paper Screen Size Selection
# Choose a pre-configured option: 
#   '4in26'      - Waveshare 4.26" (800x480) [Recommended Default]
#   '7in5'       - Waveshare 7.5" V2 (800x480)
#   '4in2'       - Waveshare 4.2" (400x300)
#   '2in9'       - Waveshare 2.9" (296x128)
SCREEN_TYPE = '4in26'

# Hardware Display Driver Selector
# Options: 
#   'mock'       - Saves to local 'debug_preview.png' file (great for debugging on PCs!)
#   'waveshare'  - Drives Waveshare SPI e-paper screens
#   'inky'       - Drives Pimoroni Inky pHAT / wHAT boards
DISPLAY_TYPE = 'waveshare'

# ==============================================================================
#                        MANUAL HARDWARE OVERRIDES
# ==============================================================================
# Set any of these to override the defaults resolved automatically by SCREEN_TYPE.
# If left as None, the settings will be perfectly resolved based on SCREEN_TYPE!
WIDTH = None
HEIGHT = None
WAVESHARE_MODEL = None

# Color Inversion
# Set to True if your screen shows white text on a black background (inverted/dark mode)
# Set to False for standard black text on a white paper background
INVERT_COLORS = False

# Fallback Poll Interval (in seconds) if server doesn't respond with one
DEFAULT_POLL_INTERVAL = 1800 
