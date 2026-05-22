# config.py - Configuration settings for the Python E-Ink Client
import os

# Server Settings
# Change to your Pi server's IP address (e.g., '192.168.1.100')
SERVER_IP = os.environ.get('TRMNL_SERVER_IP', 'localhost')
SERVER_PORT = os.environ.get('TRMNL_SERVER_PORT', '5000')

# Device Details
DEVICE_ID = 'pi_zero_screen'
WIDTH = 800
HEIGHT = 480

# Fallback Poll Interval (in seconds) if server doesn't respond with one
DEFAULT_POLL_INTERVAL = 1800 

# Hardware Display Driver Selector
# Options: 
#   'mock'       - Saves to local 'debug_preview.png' file (great for debugging on PCs!)
#   'waveshare'  - Drives Waveshare SPI e-paper screens
#   'inky'       - Drives Pimoroni Inky pHAT / wHAT boards
DISPLAY_TYPE = 'mock'

# Waveshare Screen Specific Model Configuration
# E.g. 'epd7in5_V2' (7.5" Version 2), 'epd4in2' (4.2"), 'epd2in7' (2.7")
WAVESHARE_MODEL = 'epd7in5_V2'
