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
    model = config.WAVESHARE_MODEL
    print(f"[Hardware Display] Loading Waveshare EPD driver: {model}")
    try:
        # Dynamically import waveshare e-paper drivers
        epd_module = __import__(f"waveshare_epd.{model}", fromlist=["EPD"])
        epd = epd_module.EPD()
        
        print("[Hardware Display] Initializing Waveshare EPD...")
        epd.init()
        
        # Convert image to grayscale, resize, and convert to 1-bit monochrome
        processed_img = img.convert("L").resize((epd.width, epd.height))
        processed_img = ImageOps.invert(processed_img) # Waveshare libraries often expect inverted bits
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

def poll_server():
    """Main fetch loop"""
    server_url = f"http://{config.SERVER_IP}:{config.SERVER_PORT}/api/display/image.png"
    params = {
        'device': config.DEVICE_ID,
        'width': config.WIDTH,
        'height': config.HEIGHT
    }
    
    print(f"\n==========================================")
    print(f"📡 E-Ink Client Polling Started")
    print(f"   Server Target: {server_url}")
    print(f"   Device Name:   {config.DEVICE_ID}")
    print(f"   Resolution:    {config.WIDTH}x{config.HEIGHT}px")
    print(f"   Driver Type:   {config.DISPLAY_TYPE.upper()}")
    print(f"==========================================\n")
    
    while True:
        poll_interval = config.DEFAULT_POLL_INTERVAL
        try:
            print(f"[{time.strftime('%H:%M:%S')}] Connecting to server to fetch fresh image...")
            response = requests.get(server_url, params=params, timeout=10)
            
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
            
        print(f"💤 Sleeping for {poll_interval} seconds...\n")
        time.sleep(poll_interval)

if __name__ == "__main__":
    try:
        poll_loop_interval = poll_server()
    except KeyboardInterrupt:
        print("\n👋 Client polling terminated. Exiting.")
        sys.exit(0)
