#!/usr/bin/env python3
# client.py - Polling E-Ink client script for Raspberry Pi Zero or local testing
import time
import requests
import io
import os
import sys
from PIL import Image, ImageOps

# Load configurations
try:
    import config
except ImportError:
    print("[Error] config.py not found in client directory. Please create it.")
    sys.exit(1)

# Dynamic Display Resolution & Model resolution based on SCREEN_TYPE
# Pre-configured screen definitions mapping: type -> (width, height, waveshare_model)
SCREEN_DEFINITIONS = {
    '4in26': (800, 480, 'epd4in26'),
    '7in5':  (800, 480, 'epd7in5_V2'),
    '4in2':  (400, 300, 'epd4in2'),
    '2in9':  (296, 128, 'epd2in9')
}

screen_type = getattr(config, 'SCREEN_TYPE', '4in26')
default_w, default_h, default_model = SCREEN_DEFINITIONS.get(screen_type, (800, 480, 'epd4in26'))

# Use manual overrides if provided, else use dynamically resolved defaults
WIDTH = getattr(config, 'WIDTH', None) or default_w
HEIGHT = getattr(config, 'HEIGHT', None) or default_h
WAVESHARE_MODEL = getattr(config, 'WAVESHARE_MODEL', None) or default_model
DEVICE_NAME = getattr(config, 'DEVICE_NAME', 'InkFlow Python Client')

def render_ascii_preview(img):
    """
    Renders a quick low-res ASCII thumbnail of the e-ink screen in terminal logs.
    Very helpful for head-less SSH debugging!
    """
    try:
      # Resize image to tiny scale
      small = img.resize((60, 24)).convert("L")
      chars = ["#", "@", "8", "&", "o", ":", "*", ".", " "]
      ascii_str = ""
      for y in range(small.height):
          for x in range(small.width):
              val = small.getpixel((x, y))
              char_idx = min(len(chars) - 1, int(val / 32))
              ascii_str += chars[char_idx]
          ascii_str += "\n"
      print("\n--- SCREEN ASCII PREVIEW ---")
      print(ascii_str)
      print("----------------------------\n")
    except Exception as e:
      pass

def display_mock(img):
    """Save image locally as a preview file"""
    filename = "debug_preview.png"
    img.save(filename)
    print(f"[Mock Display] Image written to local file: {os.path.abspath(filename)}")
    render_ascii_preview(img)

def display_waveshare(img):
    """Pushes image to Waveshare SPI E-Paper display"""
    model = WAVESHARE_MODEL
    print(f"[Hardware Display] Loading Waveshare EPD driver: {model}")
    try:
        # Dynamically import waveshare e-paper drivers
        epd_module = __import__(f"waveshare_epd.{model}", fromlist=["EPD"])
        epd = epd_module.EPD()
        
        print("[Hardware Display] Initializing Waveshare EPD...")
        epd.init()
        
        # Convert image to grayscale, resize, and convert to 1-bit monochrome
        processed_img = img.convert("L").resize((epd.width, epd.height))
        
        # Invert colors if configured (some Waveshare models require this, others don't)
        if getattr(config, 'INVERT_COLORS', False):
            print("[Hardware Display] Inverting color bits...")
            processed_img = ImageOps.invert(processed_img)
            
        mono_img = processed_img.convert("1")
        
        print("[Hardware Display] Writing frame buffer to display...")
        epd.display(epd.getbuffer(mono_img))
        
        print("[Hardware Display] Putting screen to sleep...")
        epd.sleep()
        print("[Hardware Display] Draw cycle complete.")
    except ImportError:
        print(f"[Error] Waveshare drivers not found for model '{model}'!")
        print("Install them by running: pip install git+https://github.com/waveshare/e-Paper.git#egg=waveshare-epd&subdirectory=RaspberryPi_JetsonNano/python")
        print("Falling back to local mockup preview file.")
        display_mock(img)
    except Exception as e:
        print(f"[Error] Waveshare hardware error: {e}")
        print("Falling back to local mockup preview file.")
        display_mock(img)

def display_inky(img):
    """Pushes image to Pimoroni Inky pHAT / wHAT displays"""
    print("[Hardware Display] Loading Pimoroni Inky auto-driver...")
    try:
        from inky.auto import auto
        inky_display = auto()
        
        print(f"[Hardware Display] Inky detected: {inky_display.colour} ({inky_display.resolution[0]}x{inky_display.resolution[1]})")
        
        # Inky accepts palette conversions
        processed_img = img.resize(inky_display.resolution).convert("L")
        
        inky_display.set_image(processed_img)
        print("[Hardware Display] Pushing frame buffer...")
        inky_display.show()
        print("[Hardware Display] Draw cycle complete.")
    except ImportError:
        print("[Error] Pimoroni Inky library not found! Install with: pip install inky")
        print("Falling back to local mockup preview file.")
        display_mock(img)
    except Exception as e:
        print(f"[Error] Inky hardware error: {e}")
        print("Falling back to local mockup preview file.")
        display_mock(img)

def get_mac_address():
    """
    Dynamically resolves physical network hardware MAC address.
    First tries to read standard Linux network interface files (perfect for Raspberry Pi).
    Falls back to built-in standard uuid.getnode() for cross-platform support.
    """
    for interface in ['wlan0', 'eth0']:
        try:
            with open(f"/sys/class/net/{interface}/address", "r") as f:
                val = f.read().strip().upper()
                if val:
                    return val
        except IOError:
            pass
    try:
        import uuid
        mac = uuid.getnode()
        # Format 48-bit int to colon-separated uppercase MAC string
        return ':'.join(['{:02X}'.format((mac >> ele) & 0xff) for ele in range(0, 8*6, 8)][::-1])
    except Exception:
        return "UNKNOWN_MAC"

def get_wifi_rssi():
    """
    Dynamically fetches WiFi link RSSI metrics on Linux platforms (like Raspberry Pi).
    Reads metrics directly from /proc/net/wireless to extract dBm signal strength.
    """
    try:
        with open("/proc/net/wireless", "r") as f:
            lines = f.readlines()
            for line in lines:
                if "wlan0" in line:
                    parts = line.split()
                    if len(parts) >= 4:
                        rssi = parts[3].replace('.', '')
                        return str(int(rssi))
    except Exception:
        pass
    return None

def poll_server():
    """Main fetch loop"""
    # Dynamically resolve MAC address if configured to do so or if empty
    device_id = getattr(config, 'DEVICE_ID', 'dynamic_mac')
    if device_id == 'dynamic_mac' or not device_id:
        print("[WiFi] Resolving dynamic hardware MAC address for device registration...")
        device_id = get_mac_address()

    server_url = f"http://{config.SERVER_IP}:{config.SERVER_PORT}/api/display/image.png"
    params = {
        'device': device_id,
        'width': WIDTH,
        'height': HEIGHT
    }
    
    print(f"\n==========================================")
    print(f"📡 E-Ink Client Polling Started")
    print(f"   Server Target: {server_url}")
    print(f"   Device Name:   {DEVICE_NAME} ({device_id})")
    print(f"   Resolution:    {WIDTH}x{HEIGHT}px")
    print(f"   Driver Type:   {config.DISPLAY_TYPE.upper()}")
    print(f"==========================================\n")
    
    while True:
        # Prevent high-frequency spinning under unexpected execution paths/errors
        time.sleep(0.1)
        poll_interval = config.DEFAULT_POLL_INTERVAL
        try:
            print(f"[{time.strftime('%H:%M:%S')}] Connecting to server to fetch fresh image...")
            
            # Gather telemetry headers dynamically
            headers = {
                'ID': device_id,
                'Access-Token': device_id,
                'Device-Name': DEVICE_NAME,
                'FW-Version': 'InkFlow-Python-v1.2.0',
                'Battery-Voltage': 'USB'
            }
            rssi = get_wifi_rssi()
            if rssi:
                headers['RSSI'] = rssi

            response = requests.get(server_url, params=params, headers=headers, timeout=10)
            
            if response.status_code == 200:
                print(f"[{time.strftime('%H:%M:%S')}] Image downloaded successfully ({len(response.content)} bytes)")
                
                # Try to parse refresh rate from header, fallback to configuration
                if 'X-Refresh-Rate' in response.headers:
                    try:
                        poll_interval = int(response.headers['X-Refresh-Rate'])
                        print(f"[{time.strftime('%H:%M:%S')}] Server set refresh rate: {poll_interval}s")
                    except ValueError:
                        pass
                
                # Load image from bytes
                image_data = io.BytesIO(response.content)
                img = Image.open(image_data)
                
                # Direct to selected driver
                if config.DISPLAY_TYPE == 'waveshare':
                    display_waveshare(img)
                elif config.DISPLAY_TYPE == 'inky':
                    display_inky(img)
                else:
                    display_mock(img)
            else:
                print(f"[Server Warning] Server responded with status code: {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            print(f"[Connection Error] Server unreachable: {e}")
            print(f"Retrying in 30 seconds...")
            time.sleep(30)
            continue
        except Exception as e:
            print(f"[Unexpected Error] {e}")
            print(f"Retrying in 30 seconds...")
            time.sleep(30)
            continue
            
        # Ensure we sleep at least 1 second to prevent tight looping if poll_interval is set incorrectly
        poll_interval = max(1, poll_interval)
        print(f"💤 Sleeping for {poll_interval} seconds...\n")
        time.sleep(poll_interval)

if __name__ == "__main__":
    try:
        poll_loop_interval = poll_server()
    except KeyboardInterrupt:
        print("\n👋 Client polling terminated. Exiting.")
        sys.exit(0)
