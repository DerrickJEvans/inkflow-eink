#!/usr/bin/env python3
# client.py - Polling E-Ink client script for Raspberry Pi Zero or local testing
import time
import requests
import io
import os
import sys
import json
from PIL import Image, ImageOps, ImageDraw, ImageFont
import http.server
import urllib.parse
import subprocess
import threading

# Load configurations
try:
    import config
except ImportError:
    print("[Error] config.py not found in client directory. Please create it.")
    sys.exit(1)

# Check for MPR121 capacitive touch module availability
mpr121 = None
mpr121_enabled = getattr(config, 'MPR121_ENABLED', False)

if mpr121_enabled:
    print("[MPR121 Startup Check] Checking for capacitive touch module...")
    try:
        # Check library installation
        import board
        import busio
        import adafruit_mpr121
        
        # Check hardware connectivity
        try:
            i2c = busio.I2C(board.SCL, board.SDA)
            mpr121 = adafruit_mpr121.MPR121(i2c)
            # Set thresholds for all pins to increase sensitivity (7 for touch, 3 for release)
            for i in range(12):
                mpr121[i].threshold = 7
                mpr121[i].release_threshold = 3
            print(f"[MPR121 Startup Check] ✅ MPR121 detected and initialized. Prev pin: {config.MPR121_PREV_PIN}, Next pin: {config.MPR121_NEXT_PIN}")

        except Exception as hardware_err:
            print(f"[MPR121 Startup Check] ⚠️  MPR121 hardware not detected or I2C bus error: {hardware_err}")
            print("[MPR121 Startup Check] Disabling touch interface. Client will run in polling-only mode.")
            mpr121 = None
            
    except ImportError as import_err:
        print(f"[MPR121 Startup Check] ⚠️  MPR121 libraries not found: {import_err}")
        print("[MPR121 Startup Check] Install with: pip3 install adafruit-circuitpython-mpr121")
        print("[MPR121 Startup Check] Disabling touch interface. Client will run in polling-only mode.")
        mpr121 = None
else:
    print("[MPR121 Startup Check] MPR121 capacitive touch is disabled in configuration.")



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
    if isinstance(img, (bytes, bytearray)):
        img = Image.frombytes("1", (WIDTH, HEIGHT), img)
        if getattr(config, 'INVERT_COLORS', False):
            img = ImageOps.invert(img.convert("L")).convert("1")
    filename = "debug_preview.png"
    img.save(filename)
    print(f"[Mock Display] Image written to local file: {os.path.abspath(filename)}")
    render_ascii_preview(img)

def apply_trmnl_hardware_optimizations(epd, model):
    """No-op: optimizations moved to custom initialization to run before booster power on."""
    pass

def init_trmnl_hardware_7in5(epd):
    """
    Performs register-level hardware initialization matching the C++ driver.
    Crucial to configure booster/voltages BEFORE turning on power (0x04) to avoid charge pump crashes.
    """
    print("[Hardware Display] Executing custom C++ TRMNL hardware initialization sequence...")
    
    # Initialize low-level SPI and GPIO config first!
    import waveshare_epd.epdconfig as epdconfig
    if epdconfig.module_init() != 0:
        raise IOError("Waveshare SPI/GPIO module_init failed")
        
    # 1. Reset EPD controller
    for method_name in ['reset', 'Reset']:
        if hasattr(epd, method_name):
            getattr(epd, method_name)()
            break
            
    # Helper wrappers to handle case variations dynamically
    def send_cmd(command):
        for method_name in ['send_command', 'SendCommand']:
            if hasattr(epd, method_name):
                getattr(epd, method_name)(command)
                return
        raise AttributeError("EPD object lacks command sender")
        
    def send_val(data):
        for method_name in ['send_data', 'SendData']:
            if hasattr(epd, method_name):
                getattr(epd, method_name)(data)
                return
        raise AttributeError("EPD object lacks data sender")
        
    def wait_busy():
        for method_name in ['ReadBusy', 'read_busy', 'wait_busy']:
            if hasattr(epd, method_name):
                getattr(epd, method_name)()
                return

    # 2. Power setting
    send_cmd(0x01)
    send_val(0x17)
    send_val(0x17)  # VGH/VGL voltage
    send_val(0x3F)  # VSH
    send_val(0x3F)  # VSL
    send_val(0x11)  # VSHR
    
    # 3. VCOM DC Setting
    send_cmd(0x82)
    send_val(0x24)
    
    # 4. Booster Setting
    send_cmd(0x06)
    send_val(0x27)
    send_val(0x27)
    send_val(0x2F)
    send_val(0x17)
    
    # 5. OSC Setting (frequency adjustment)
    send_cmd(0x30)
    send_val(0x06)
    
    # 6. Power On
    send_cmd(0x04)
    time.sleep(0.1)
    wait_busy()
    
    # 7. Panel Setting
    send_cmd(0x00)
    send_val(0x3F)
    
    # 8. Resolution Setting (tres)
    send_cmd(0x61)
    send_val(0x03)  # source 800
    send_val(0x20)
    send_val(0x01)  # gate 480
    send_val(0xE0)
    
    # 9. Dual-stage Resolution config
    send_cmd(0x15)
    send_val(0x00)
    
    # 10. VCOM and Data Interval Setting
    send_cmd(0x50)
    send_val(0x10)
    send_val(0x00)  # Match C++ border setting (0x00) to prevent charge traps
    
    # 11. TCON Setting
    send_cmd(0X60)
    send_val(0x22)
    
    # 12. Resolution Setting (second round)
    send_cmd(0x65)
    send_val(0x00)
    send_val(0x00)
    send_val(0x00)
    send_val(0x00)

def display_waveshare(img, partial=False, sleep_after=True):
    """Pushes image to Waveshare SPI E-Paper display"""
    model = WAVESHARE_MODEL
    print(f"[Hardware Display] Loading Waveshare EPD driver: {model}")
    try:
        # Force reload waveshare modules to ensure a fresh SPI file descriptor is opened
        import sys
        import importlib
        cfg_mod = sys.modules.get('waveshare_epd.epdconfig')
        if cfg_mod:
            print("[Hardware Display] Releasing active gpiozero pin objects before module reload...")
            impl = getattr(cfg_mod, 'implementation', None)
            objects_to_check = [cfg_mod]
            if impl:
                objects_to_check.append(impl)
            for obj in objects_to_check:
                for attr_name in dir(obj):
                    if attr_name.endswith('_PIN') or attr_name == 'SPI':
                        attr = getattr(obj, attr_name)
                        if hasattr(attr, 'close'):
                            try:
                                attr.close()
                            except Exception:
                                pass
                            
        for mod in ['waveshare_epd.epdconfig', f'waveshare_epd.{model}']:
            if mod in sys.modules:
                try:
                    importlib.reload(sys.modules[mod])
                except Exception as e:
                    print(f"[Warning] Failed to reload module {mod}: {e}")

        # Dynamically import waveshare e-paper drivers
        epd_module = __import__(f"waveshare_epd.{model}", fromlist=["EPD"])
        epd = epd_module.EPD()
        
        # Check for partial update capabilities in the driver
        init_part_func = None
        display_part_func = None
        
        for init_name in ['init_Partial', 'init_part', 'init_part_refresh']:
            if hasattr(epd, init_name):
                init_part_func = getattr(epd, init_name)
                break
        for display_name in ['display_Partial', 'display_Part', 'display_part']:
            if hasattr(epd, display_name):
                display_part_func = getattr(epd, display_name)
                break
                
        has_partial_support = (init_part_func is not None and display_part_func is not None)
        
        # Force full refresh if partial updates are not supported by the driver
        actual_partial = partial and has_partial_support
        
        # Respect user configured sleep behavior (especially for screens that fade on sleep)
        configured_sleep = getattr(config, 'SLEEP_AFTER', True)
        if not configured_sleep:
            actual_sleep_after = False
        else:
            actual_sleep_after = sleep_after if has_partial_support else True
        
        # Check if incoming data is a raw byte stream
        is_raw_bytes = isinstance(img, (bytes, bytearray))
        
        if is_raw_bytes:
            print("[Hardware Display] Processing raw 1-bit pixel stream directly...")
            # The official Waveshare Python EPD library performs a bitwise NOT (inversion)
            # internally on the buffer before sending to SPI, whereas the C++ firmware does not.
            # We compensate for this default library inversion, while respecting user settings.
            if not getattr(config, 'INVERT_COLORS', False):
                buffer = [~b & 0xFF for b in img]
            else:
                buffer = list(img)
        else:
            # Convert image to grayscale, resize, and convert to 1-bit monochrome
            processed_img = img.convert("L").resize((epd.width, epd.height))
            
            # Invert colors if configured (some Waveshare models require this, others don't)
            if getattr(config, 'INVERT_COLORS', False):
                print("[Hardware Display] Inverting color bits...")
                processed_img = ImageOps.invert(processed_img)
                
            mono_img = processed_img.convert("1")
            buffer = epd.getbuffer(mono_img)
        
        if actual_partial:
            print("[Hardware Display] Initializing Waveshare EPD (Partial Refresh)...")
            init_part_func()
            print("[Hardware Display] Writing partial frame buffer to display...")
            display_part_func(buffer)
        else:
            print("[Hardware Display] Initializing Waveshare EPD (Full Refresh)...")
            epd.init()
            
            # Apply border data interval override to prevent edge fading (match C++ driver)
            try:
                def send_cmd(command):
                    for method in ['send_command', 'SendCommand']:
                        if hasattr(epd, method):
                            getattr(epd, method)(command)
                            return
                def send_val(data):
                    for method in ['send_data', 'SendData']:
                        if hasattr(epd, method):
                            getattr(epd, method)(data)
                            return
                send_cmd(0x50)
                send_val(0x10)
                send_val(0x00) # 0x00 disables border current draw, preventing edge voltage drop
                print("[Hardware Display] Border interval optimized to 0x00 (floating border).")
            except Exception as e:
                print(f"[Warning] Failed to optimize border: {e}")
                
            print("[Hardware Display] Writing full frame buffer to display...")
            epd.display(buffer)
            
        # Delay to let physical pixels stabilize and charge pump voltages settle before sleeping
        if actual_sleep_after:
            sleep_delay = getattr(config, 'SLEEP_DELAY', 6.0)
            if sleep_delay > 0:
                print(f"[Hardware Display] Waiting {sleep_delay} seconds for screen voltages to settle...")
                time.sleep(sleep_delay)
            print("[Hardware Display] Putting screen to sleep...")
            epd.sleep()
            
            # Clean up GPIO pins and SPI port to prevent leakage current from Pi to HAT
            for method_name in ['Dev_Exit', 'dev_exit', 'module_exit']:
                if hasattr(epd, method_name):
                    print("[Hardware Display] Cleaning up GPIO pins (preventing leakage current)...")
                    getattr(epd, method_name)()
                    break
            print("[Hardware Display] Draw cycle complete (screen put to sleep & GPIOs cleaned up).")
        else:
            print("[Hardware Display] Draw cycle complete (screen kept awake for subsequent updates).")
    except ImportError:
        print(f"[Error] Waveshare drivers not found for model '{model}'!")
        print("Install them by running: pip install git+https://github.com/waveshare/e-Paper.git#egg=waveshare-epd&subdirectory=RaspberryPi_JetsonNano/python")
        print("Falling back to local mockup preview file.")
        if isinstance(img, (bytes, bytearray)):
            img = Image.frombytes("1", (WIDTH, HEIGHT), img)
            if getattr(config, 'INVERT_COLORS', False):
                img = ImageOps.invert(img.convert("L")).convert("1")
        display_mock(img)
    except Exception as e:
        print(f"[Error] Waveshare hardware error: {e}")
        print("Falling back to local mockup preview file.")
        if isinstance(img, (bytes, bytearray)):
            img = Image.frombytes("1", (WIDTH, HEIGHT), img)
            if getattr(config, 'INVERT_COLORS', False):
                img = ImageOps.invert(img.convert("L")).convert("1")
        display_mock(img)

def display_inky(img):
    """Pushes image to Pimoroni Inky pHAT / wHAT displays"""
    if isinstance(img, (bytes, bytearray)):
        img = Image.frombytes("1", (WIDTH, HEIGHT), img)
        if getattr(config, 'INVERT_COLORS', False):
            img = ImageOps.invert(img.convert("L")).convert("1")
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

# ==============================================================================
#                  LOCAL CACHING UTILITIES
# ==============================================================================
def get_cache_dir():
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir

def read_cache_manifest():
    cache_dir = get_cache_dir()
    manifest_path = os.path.join(cache_dir, 'cache_manifest.json')
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[Cache Warning] Failed to parse cache manifest: {e}")
    return {}

def write_cache_manifest(manifest):
    cache_dir = get_cache_dir()
    manifest_path = os.path.join(cache_dir, 'cache_manifest.json')
    try:
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
    except Exception as e:
        print(f"[Cache Error] Failed to write cache manifest: {e}")

def get_cached_slide(index):
    cache_dir = get_cache_dir()
    slide_path = os.path.join(cache_dir, f"slide_{index}.raw")
    if os.path.exists(slide_path):
        try:
            with open(slide_path, 'rb') as f:
                return f.read()
        except Exception as e:
            print(f"[Cache Error] Failed to read cached slide {index}: {e}")
    return None

def save_cached_slide(index, raw_bytes):
    cache_dir = get_cache_dir()
    slide_path = os.path.join(cache_dir, f"slide_{index}.raw")
    try:
        with open(slide_path, 'wb') as f:
            f.write(raw_bytes)
    except Exception as e:
        print(f"[Cache Error] Failed to write cached slide {index}: {e}")

def clear_cache_slides():
    cache_dir = get_cache_dir()
    for filename in os.listdir(cache_dir):
        if filename.startswith("slide_") and filename.endswith(".raw"):
            try:
                os.remove(os.path.join(cache_dir, filename))
            except Exception:
                pass

# ==============================================================================
#                  AP CONFIGURATION PORTAL WIZARD
# ==============================================================================
httpd = None
last_connection_error = None
client_connected = False

def update_env_file(updates):
    """Updates the local .env configuration file with the provided dictionary of key-value pairs"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    lines = []
    if os.path.exists(env_path):
        try:
            with open(env_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except PermissionError:
            try:
                import getpass
                current_user = getpass.getuser()
                subprocess.run(["sudo", "chown", current_user, env_path], capture_output=True, timeout=5)
                with open(env_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            except Exception as e:
                print(f"[Error] Failed to read .env or fix ownership: {e}")
                return
            
    new_lines = []
    updates_remaining = updates.copy()
    
    for line in lines:
        stripped = line.strip()
        if '=' in stripped and not stripped.startswith('#'):
            key, val = stripped.split('=', 1)
            key = key.strip()
            if key in updates_remaining:
                new_lines.append(f"{key}={updates_remaining[key]}\n")
                del updates_remaining[key]
                continue
        new_lines.append(line)
        
    # Append any remaining keys that weren't in the original file
    for key, val in updates_remaining.items():
        new_lines.append(f"{key}={val}\n")
        
    try:
        with open(env_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
    except PermissionError:
        try:
            import getpass
            current_user = getpass.getuser()
            subprocess.run(["sudo", "chown", current_user, env_path], capture_output=True, timeout=5)
            with open(env_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f"[Config] Successfully corrected ownership of {env_path} and saved settings.")
        except Exception as e:
            print(f"[Error] Failed to write .env or fix ownership: {e}")

def draw_setup_splash(error_msg=None, step=1):
    """Renders the setup wizard splash screen onto the display"""
    print(f"[Display] Drawing setup wizard splash screen (Step {step}/2)...")
    
    img = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(img)
    
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except IOError:
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
        font_small = ImageFont.load_default()
        
    # Draw outer double border
    draw.rectangle([5, 5, WIDTH - 6, HEIGHT - 6], outline=0)
    draw.rectangle([8, 8, WIDTH - 9, HEIGHT - 9], outline=0)
    
    # Header
    draw.text((25, 30), f"InkFlow E-Ink Setup (Step {step}/2)", fill=0, font=font_large)
    draw.text((25, 60), "Configure your wireless device portal:", fill=0, font=font_medium)
    draw.line([(20, 80), (WIDTH - 20, 80)], fill=0)
    
    if step == 1:
        # Steps for WiFi connection
        draw.text((25, 95), "1. Connect your phone or PC to the setup WiFi network:", fill=0, font=font_medium)
        draw.text((45, 125), "SSID: InkFlow-Setup (Password: 12345678)", fill=0, font=font_large)
        draw.text((45, 160), "(Or scan the WiFi QR code on the right to connect)", fill=0, font=font_medium)
        
        draw.text((25, 205), "2. Once connected, this screen will automatically refresh", fill=0, font=font_medium)
        draw.text((45, 230), "and display the setup portal link and QR code.", fill=0, font=font_medium)
    else:
        # Steps for Setup Portal opening
        draw.text((25, 95), "🟢 DEVICE CONNECTED SUCCESSFULLY!", fill=0, font=font_large)
        
        draw.text((25, 140), "2. Open the setup portal browser page to configure device:", fill=0, font=font_medium)
        draw.text((45, 170), "Go to: http://10.42.0.1:8080", fill=0, font=font_large)
        draw.text((45, 205), "(Or scan the URL QR code on the right to open portal)", fill=0, font=font_medium)
        
        draw.text((25, 250), "3. Enter your WiFi network password, server address, and save.", fill=0, font=font_medium)
    
    # Connection QR Code on the right (Only for screens 800px wide or larger)
    if WIDTH >= 800:
        try:
            import qrcode
            
            if step == 1:
                # 1. WiFi QR Code
                qr_wifi = qrcode.QRCode(version=1, box_size=3, border=2)
                qr_wifi.add_data("WIFI:S:InkFlow-Setup;T:WPA;P:12345678;;")
                qr_wifi.make(fit=True)
                qr_wifi_img = qr_wifi.make_image(fill_color="black", back_color="white")
                qr_wifi_img = qr_wifi_img.convert("L").resize((110, 110))
                img.paste(qr_wifi_img, (620, 170))
                
                label = "Scan to Connect"
            else:
                # 2. URL QR Code
                qr_url = qrcode.QRCode(version=1, box_size=3, border=2)
                qr_url.add_data("http://10.42.0.1:8080")
                qr_url.make(fit=True)
                qr_url_img = qr_url.make_image(fill_color="black", back_color="white")
                qr_url_img = qr_url_img.convert("L").resize((110, 110))
                img.paste(qr_url_img, (620, 170))
                
                label = "Scan to Open Portal"
                
            try:
                bbox = draw.textbbox((0, 0), label, font=font_small)
                lbl_w = bbox[2] - bbox[0]
            except AttributeError:
                try:
                    lbl_w = font_small.getsize(label)[0]
                except AttributeError:
                    lbl_w = len(label) * 7
            draw.text((675 - lbl_w // 2, 290), label, fill=0, font=font_small)
        except ImportError:
            pass
    
    # Connection error box (drawn only on the left to avoid overlapping QR codes)
    if error_msg:
        draw.rectangle([20, 295, 580, 430], outline=0, width=2)
        draw.rectangle([22, 297, 578, 330], fill=0)
        draw.text((35, 305), "⚠️ CONNECTION ERROR", fill=255, font=font_medium)
        
        # Word wrap the error message if it's too long (fits ~50 chars in the narrower box)
        if len(error_msg) > 50:
            words = error_msg.split()
            lines_to_draw = []
            current_line = ""
            for word in words:
                if len(current_line) + len(word) + 1 < 50:
                    current_line += (word + " ")
                else:
                    lines_to_draw.append(current_line.strip())
                    current_line = word + " "
            if current_line:
                lines_to_draw.append(current_line.strip())
            
            y_offset = 345
            for line in lines_to_draw[:3]: # limit to 3 lines
                draw.text((35, y_offset), line, fill=0, font=font_medium)
                y_offset += 25
        else:
            draw.text((35, 345), error_msg, fill=0, font=font_medium)
            
    # Footer / MAC
    draw.line([(20, HEIGHT - 40), (WIDTH - 20, HEIGHT - 40)], fill=0)
    mac = get_mac_address()
    draw.text((25, HEIGHT - 28), f"Device MAC Address: {mac}", fill=0, font=font_medium)
    
    if config.DISPLAY_TYPE == 'waveshare':
        display_waveshare(img)
    elif config.DISPLAY_TYPE == 'inky':
        display_inky(img)
    else:
        display_mock(img)

def draw_connecting_splash(ssid, server_ip, port, step=0):
    """Renders the connecting status splash screen onto the display"""
    print(f"[Display] Drawing connecting status splash screen (Step {step})...")
    
    img = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(img)
    
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    except IOError:
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
        
    draw.rectangle([5, 5, WIDTH - 6, HEIGHT - 6], outline=0)
    
    draw.text((25, 35), "Connecting Screen...", fill=0, font=font_large)
    draw.text((25, 70), "Applying new credentials and establishing link:", fill=0, font=font_medium)
    draw.line([(20, 85), (WIDTH - 20, 85)], fill=0)
    
    draw.text((25, 105), f"WiFi SSID:  {ssid}", fill=0, font=font_medium)
    draw.text((25, 130), f"Server IP:  {server_ip}", fill=0, font=font_medium)
    draw.text((25, 155), f"Port Bind:  {port}", fill=0, font=font_medium)
    
    draw.line([(20, 185), (WIDTH - 20, 185)], fill=0)
    draw.text((25, 195), "Connection Progress:", fill=0, font=font_medium)
    
    # Progress steps based on step level (using safe ASCII status indicators)
    s0 = "[OK] Saved configuration settings" if step >= 1 else "[>>] Saving configuration settings..."
    s1 = "[OK] Disconnected setup AP hotspot" if step >= 2 else ("[>>] Disconnecting setup AP hotspot..." if step == 1 else "[  ] Disconnect setup AP hotspot")
    s2 = "[OK] Connected to WiFi network" if step >= 3 else ("[>>] Connecting to WiFi network..." if step == 2 else "[  ] Connect to WiFi network")
    s3 = "[>>] Starting client sync daemon..." if step == 3 else "[  ] Start client sync daemon"
    
    draw.text((45, 225), s0, fill=0, font=font_medium)
    draw.text((45, 255), s1, fill=0, font=font_medium)
    draw.text((45, 285), s2, fill=0, font=font_medium)
    draw.text((45, 315), s3, fill=0, font=font_medium)
    
    draw.line([(20, HEIGHT - 40), (WIDTH - 20, HEIGHT - 40)], fill=0)
    mac = get_mac_address()
    draw.text((25, HEIGHT - 28), f"Device MAC Address: {mac}", fill=0, font=font_medium)
    
    if config.DISPLAY_TYPE == 'waveshare':
        # Always do a clean full refresh and put the screen to sleep for this single update.
        # This completely prevents hardware timing conflicts or SPI lockups.
        display_waveshare(img, partial=False, sleep_after=True)
    elif config.DISPLAY_TYPE == 'inky':
        display_inky(img)
    else:
        display_mock(img)

class SetupPortalHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to suppress standard HTTP logging to keep stdout clean
        pass

    def do_GET(self):
        global last_connection_error, client_connected
        parsed_url = urllib.parse.urlparse(self.path)
        
        # Trigger display refresh to Step 2 (Portal URL) on first client connection
        if not client_connected and parsed_url.path != "/status":
            client_connected = True
            print("[Setup Portal] Client connected. Redrawing screen to show Portal URL QR code...")
            draw_setup_splash(error_msg=last_connection_error, step=2)
            
        # Check for async connection status endpoint
        if parsed_url.path == "/status":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            if last_connection_error:
                response = f'{{"status": "failed", "error": "{last_connection_error}"}}'
            else:
                response = '{"status": "connecting"}'
                
            self.wfile.write(response.encode("utf-8"))
            return

        # Redirect all domains (Captive Portal) to root '/' except local routes
        if parsed_url.path not in ["/", "/save", "/generate_204", "/fwlink", "/status"]:
            self.send_response(302)
            self.send_header("Location", "http://10.42.0.1:8080/")
            self.end_headers()
            return
            
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        
        # Scan wifi networks via nmcli
        wifi_options = ""
        try:
            res = subprocess.run(["nmcli", "-t", "-f", "SSID,SIGNAL", "dev", "wifi"], capture_output=True, text=True, timeout=5)
            seen = set()
            for line in res.stdout.strip().split("\n"):
                if line and ":" in line:
                    parts = line.split(":", 1)
                    ssid = parts[0].strip()
                    signal = parts[1].strip()
                    if ssid and ssid not in seen:
                        seen.add(ssid)
                        wifi_options += f'<option value="{ssid}">{ssid} ({signal}%)</option>\n'
        except Exception:
            pass

        mac = get_mac_address()
        
        # Check for connection errors from previous attempts
        error_banner = ""
        if last_connection_error:
            error_banner = f"""
            <div class="alert">
              ⚠️ <strong>Connection Failed:</strong> {last_connection_error}
            </div>
            """
        
        # Serve the premium styled setup web page
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InkFlow E-Ink Setup Wizard</title>
  <style>
    :root {{
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --bg: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.7);
      --border: rgba(255, 255, 255, 0.1);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }}
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    body {{
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }}
    .container {{
      width: 100%;
      max-width: 500px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }}
    .alert {{
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #f87171;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      line-height: 1.5;
    }}
    .header {{
      text-align: center;
      margin-bottom: 25px;
    }}
    .header h1 {{
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
      background: linear-gradient(135deg, #a5b4fc, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}
    .header p {{
      font-size: 14px;
      color: var(--text-muted);
    }}
    .form-group {{
      margin-bottom: 20px;
    }}
    .form-group label {{
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }}
    .form-group input, .form-group select {{
      width: 100%;
      padding: 12px 16px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 15px;
      outline: none;
      transition: all 0.2s ease;
    }}
    .form-group input:focus, .form-group select:focus {{
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }}
    .btn-submit {{
      width: 100%;
      padding: 14px;
      background: var(--primary);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 10px;
      box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.2);
    }}
    .btn-submit:hover {{
      background: var(--primary-hover);
      box-shadow: 0 4px 12px -1px rgba(99, 102, 241, 0.3);
    }}
    .footer {{
      text-align: center;
      margin-top: 25px;
      font-size: 12px;
      color: var(--text-muted);
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>InkFlow Setup Wizard</h1>
      <p>Configure wireless network and server connections</p>
    </div>
    
    {error_banner}
    
    <form action="/save" method="POST">
      <div class="form-group">
        <label for="ssid">Scanned WiFi Networks</label>
        <select id="ssid" name="ssid" onchange="document.getElementById('manual_ssid').value = this.value">
          <option value="">-- Select Network --</option>
          {wifi_options}
        </select>
      </div>

      <div class="form-group">
        <label for="manual_ssid">WiFi SSID (or Manual Entry)</label>
        <input type="text" id="manual_ssid" name="manual_ssid" placeholder="Enter WiFi SSID" required>
      </div>
      
      <div class="form-group">
        <label for="password">WiFi Password</label>
        <div style="position: relative;">
          <input type="password" id="password" name="password" placeholder="Enter WiFi Password" style="padding-right: 60px;">
          <button type="button" id="togglePassword" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; font-weight: 600; outline: none;">Show</button>
        </div>
      </div>
      
      <div class="form-group">
        <label for="server">InkFlow Server Host / IP</label>
        <input type="text" id="server" name="server" placeholder="e.g. 192.168.1.122 or mydns.local" required>
      </div>
      
      <div class="form-group">
        <label for="port">Server Port</label>
        <input type="number" id="port" name="port" value="5000" placeholder="5000" required>
      </div>
      
      <div class="form-group">
        <label for="devicename">Custom Device Name</label>
        <input type="text" id="devicename" name="devicename" value="Living Room Pi Panel" placeholder="e.g. Kitchen Display">
      </div>
      
      <button type="submit" class="btn-submit">Save Settings & Connect</button>
    </form>
    
    <div class="footer">
      Device MAC Address: {mac}
    </div>
  </div>
  <script>
    document.addEventListener("DOMContentLoaded", function() {{
      const passwordInput = document.getElementById("password");
      const togglePassword = document.getElementById("togglePassword");
      if (passwordInput && togglePassword) {{
        togglePassword.addEventListener("click", function() {{
          if (passwordInput.type === "password") {{
            passwordInput.type = "text";
            togglePassword.textContent = "Hide";
          }} else {{
            passwordInput.type = "password";
            togglePassword.textContent = "Show";
          }}
        }});
      }}
    }});
  </script>
</body>
</html>"""
        self.wfile.write(html.encode("utf-8"))

    def do_POST(self):
        if self.path == "/save":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            params = urllib.parse.parse_qs(post_data)
            
            ssid = params.get('manual_ssid', [''])[0].strip()
            password = params.get('password', [''])[0].strip()
            server_ip = params.get('server', [''])[0].strip()
            port = params.get('port', ['5000'])[0].strip()
            device_name = params.get('devicename', [''])[0].strip()
            
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            
            response_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Saved</title>
  <style>
    body {{
      background: #0f172a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      text-align: center;
      padding: 20px;
    }}
    .card {{
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 450px;
    }}
    h1 {{ color: #818cf8; margin-bottom: 15px; font-size: 22px; }}
    p {{ color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 20px; }}
    .loader {{
      border: 4px solid rgba(255,255,255,0.1);
      border-top: 4px solid #6366f1;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto 0;
    }}
    @keyframes spin {{
      0% {{ transform: rotate(0deg); }}
      100% {{ transform: rotate(360deg); }}
    }}
  </style>
</head>
<body>
  <div class="card">
    <h1>Settings Saved Successfully!</h1>
    <p>Your InkFlow E-Ink device is now connecting to <strong>{ssid}</strong>.</p>
    <p>Please check your E-Paper display. It will refresh to show connection status shortly.</p>
    <div class="loader"></div>
  </div>
  <script>
    function checkStatus() {{
      fetch('/status')
        .then(response => response.json())
        .then(data => {{
          if (data.status === 'failed') {{
            window.location.href = '/';
          }} else {{
            setTimeout(checkStatus, 2000);
          }}
        }})
        .catch(err => {{
          setTimeout(checkStatus, 2000);
        }});
    }}
    setTimeout(checkStatus, 5000);
  </script>
</body>
</html>"""
            self.wfile.write(response_html.encode("utf-8"))
            
            # Start background connection routine
            threading.Thread(target=apply_config_and_reconnect, args=(ssid, password, server_ip, port, device_name)).start()

def apply_config_and_reconnect(ssid, password, server_ip, port, device_name):
    """Saves settings, turns down AP hotspot, connects to user's wifi and restarts the client daemon"""
    global last_connection_error
    try:
        # Draw connecting splash screen ONCE showing the WiFi connection progress (Step 2)
        # Doing this exactly once avoids timing issues and locks up with Waveshare E-Paper refreshes.
        draw_connecting_splash(ssid, server_ip, port, step=2)
        
        # Save the settings
        updates = {
            'TRMNL_SERVER_IP': server_ip,
            'TRMNL_SERVER_PORT': port,
            'TRMNL_DEVICE_NAME': device_name
        }
        update_env_file(updates)
        
        # Clean up the AP hotspot connection
        try:
            subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
            subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
        except Exception:
            pass
            
        # Attempt to connect to the new WiFi network
        connected = False
        if ssid:
            print(f"[Setup Portal] Connecting to WiFi network: {ssid}...")
            try:
                if password:
                    res = subprocess.run(["sudo", "nmcli", "dev", "wifi", "connect", ssid, "password", password], capture_output=True, text=True, timeout=30)
                else:
                    res = subprocess.run(["sudo", "nmcli", "dev", "wifi", "connect", ssid], capture_output=True, text=True, timeout=30)
                
                if res.returncode == 0:
                    connected = True
                    print("[Setup Portal] WiFi connection successful!")
                else:
                    print(f"[Setup Portal] WiFi connection failed: {res.stderr or res.stdout}")
            except FileNotFoundError:
                # Handle local development / testing environments where nmcli is not available
                print("[Setup Portal] nmcli not found. Assuming connection success for local/mock development.")
                connected = True
            except Exception as e:
                print(f"[Setup Portal] Error connecting to WiFi network: {e}")
                
        if connected:
            # Stop the web server
            global httpd
            if httpd:
                print("[Setup Portal] Stopping setup web server...")
                httpd.shutdown()
                
            print("[Setup Portal] Restarting client process to apply configurations...")
            time.sleep(1)
            os.execv(sys.executable, [sys.executable] + sys.argv)
        else:
            last_connection_error = f"Failed to connect to '{ssid}'. Please check credentials and try again."
            
            # Clean up the failed connection profile
            try:
                subprocess.run(["sudo", "nmcli", "con", "delete", "id", ssid], capture_output=True, timeout=10)
            except Exception:
                pass
                
            # Re-activate the setup AP hotspot
            print("[Setup Portal] WiFi connection failed. Re-activating AP setup hotspot...")
            try:
                subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
                subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
                subprocess.run(["sudo", "nmcli", "dev", "wifi", "hotspot", "ssid", "InkFlow-Setup", "password", "12345678"], capture_output=True, timeout=20)
            except Exception as e:
                print(f"[Setup Portal] Warning: Re-activating hotspot failed: {e}")
                
            # Redraw the setup splash screen with the error message
            draw_setup_splash(error_msg=last_connection_error)
            
    except Exception as err:
        print(f"[Setup Portal] Unexpected error in connection routine: {err}")
        last_connection_error = f"System error: {err}"
        
        # Clean up failed profile and restore hotspot on crash
        try:
            subprocess.run(["sudo", "nmcli", "con", "delete", "id", ssid], capture_output=True, timeout=10)
        except Exception:
            pass
        try:
            subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
            subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
            subprocess.run(["sudo", "nmcli", "dev", "wifi", "hotspot", "ssid", "InkFlow-Setup", "password", "12345678"], capture_output=True, timeout=20)
        except Exception:
            pass
            
        draw_setup_splash(error_msg=last_connection_error)

def check_hotspot_connections():
    """Parses /proc/net/arp to see if any client is connected to the 10.42.0.X subnet"""
    try:
        if not os.path.exists("/proc/net/arp"):
            return False
        with open("/proc/net/arp", "r") as f:
            lines = f.readlines()
        for line in lines[1:]:  # Skip header row
            parts = line.split()
            if len(parts) >= 6:
                ip = parts[0]
                mac = parts[3]
                flags = parts[2]
                # Check for client IPs in the NetworkManager hotspot subnet (10.42.0.2 to 10.42.0.254)
                if ip.startswith("10.42.0.") and ip != "10.42.0.1":
                    if mac != "00:00:00:00:00:00" and flags != "0x0":
                        return True
    except Exception as e:
        print(f"[Setup Portal] Error checking ARP table: {e}")
    return False

def connection_monitor_thread():
    """Background thread to poll ARP table and update the E-Ink display on client connection"""
    global client_connected
    print("[Setup Portal] Connection monitor thread started.")
    while httpd and not client_connected:
        if check_hotspot_connections():
            client_connected = True
            print("[Setup Portal] Detected client connection via ARP table. Swapping screen...")
            draw_setup_splash(error_msg=last_connection_error, step=2)
            break
        time.sleep(2)

def enter_ap_setup_mode():
    """Starts AP mode and serves the captive configuration portal"""
    print("[Setup Portal] Entering configuration AP mode...")
    
    global last_connection_error, client_connected, httpd
    last_connection_error = None
    client_connected = False
    
    # 1. Show setup wizard splash
    draw_setup_splash()
    
    # 2. Start the access point
    try:
        subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
        subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
    except Exception:
        pass
        
    print("[Setup Portal] Launching Hotspot SSID 'InkFlow-Setup' (Password: 12345678)...")
    try:
        subprocess.run(["sudo", "nmcli", "dev", "wifi", "hotspot", "ssid", "InkFlow-Setup", "password", "12345678"], capture_output=True, timeout=20)
    except Exception as e:
        print(f"[Setup Portal] Warning: Hotspot command failed: {e}")
        
    # 3. Spawn HTTP server
    server_address = ('', 8080)
    httpd = http.server.HTTPServer(server_address, SetupPortalHandler)
    print("[Setup Portal] Configuration portal is active at http://10.42.0.1:8080")
    
    # Spawn background connection monitor thread
    import threading
    monitor = threading.Thread(target=connection_monitor_thread, daemon=True)
    monitor.start()
    
    try:
        httpd.serve_forever()
    except Exception as e:
        print(f"[Setup Portal] Server shutdown: {e}")
    finally:
        httpd.server_close()
        httpd = None
        print("[Setup Portal] Setup portal closed.")

def get_local_ip():
    """Dynamically resolves local IP address for outbound network interface"""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_cpu_temp():
    """Reads physical thermal sensor registers on Linux/Raspberry Pi"""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            temp = float(f.read().strip()) / 1000.0
            return f"{temp:.1f}°C"
    except Exception:
        return "N/A"

def get_sys_stats():
    """Queries uptime and CPU load statistics from system registers"""
    uptime = "N/A"
    try:
        with open("/proc/uptime", "r") as f:
            uptime_seconds = float(f.readline().split()[0])
            hours = int(uptime_seconds // 3600)
            minutes = int((uptime_seconds % 3600) // 60)
            uptime = f"{hours}h {minutes}m"
    except Exception:
        pass
        
    load = "N/A"
    try:
        with open("/proc/loadavg", "r") as f:
            load = f.readline().split()[0]
    except Exception:
        pass
        
    return uptime, load

def draw_diagnostics_overlay(last_sync_time):
    """Renders a comprehensive system diagnostics report on E-Ink screen"""
    print("[Display] Drawing system diagnostics overlay...")
    
    img = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(img)
    
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except IOError:
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
        font_small = ImageFont.load_default()
        
    # Draw double border
    draw.rectangle([5, 5, WIDTH - 6, HEIGHT - 6], outline=0)
    draw.rectangle([8, 8, WIDTH - 9, HEIGHT - 9], outline=0)
    
    # Header
    draw.text((25, 30), "System Diagnostics Scan", fill=0, font=font_large)
    draw.text((25, 60), "Active status report of the local client environment:", fill=0, font=font_medium)
    draw.line([(20, 80), (WIDTH - 20, 80)], fill=0)
    
    # Gather specs
    ip = get_local_ip()
    mac = get_mac_address()
    rssi = get_wifi_rssi() or "N/A"
    temp = get_cpu_temp()
    uptime, load = get_sys_stats()
    sync_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(last_sync_time)) if last_sync_time > 0 else "Never"
    
    if WIDTH >= 600:
        # Draw dynamic double columns
        draw.text((35, 105), f"🖥️ Device Name:  {DEVICE_NAME}", fill=0, font=font_medium)
        draw.text((35, 135), f"🔌 Server IP:   {config.SERVER_IP}:{config.SERVER_PORT}", fill=0, font=font_medium)
        draw.text((35, 165), f"🌐 Local IP:    {ip}", fill=0, font=font_medium)
        draw.text((35, 195), f"📡 WiFi RSSI:   {rssi} dBm", fill=0, font=font_medium)
        
        draw.text((WIDTH // 2 + 10, 105), f"🏷️ MAC Address:  {mac}", fill=0, font=font_medium)
        draw.text((WIDTH // 2 + 10, 135), f"⏳ Sys Uptime:  {uptime}", fill=0, font=font_medium)
        draw.text((WIDTH // 2 + 10, 165), f"🔥 CPU Temp:    {temp} (Load: {load})", fill=0, font=font_medium)
        draw.text((WIDTH // 2 + 10, 195), f"⏱️ Last Sync:   {sync_str}", fill=0, font=font_medium)
    else:
        # Fallback layout for narrower displays
        draw.text((25, 95), f"🖥️ Name:  {DEVICE_NAME}", fill=0, font=font_small)
        draw.text((25, 115), f"🔌 Server: {config.SERVER_IP}:{config.SERVER_PORT}", fill=0, font=font_small)
        draw.text((25, 135), f"🌐 IP:     {ip}  | MAC: {mac}", fill=0, font=font_small)
        draw.text((25, 155), f"📡 RSSI:   {rssi} dBm | Temp: {temp}", fill=0, font=font_small)
        draw.text((25, 175), f"⏳ Uptime: {uptime} | Load: {load}", fill=0, font=font_small)
        draw.text((25, 195), f"⏱️ Sync:   {sync_str}", fill=0, font=font_small)
        
    # Footer Action info
    draw.line([(20, HEIGHT - 55), (WIDTH - 20, HEIGHT - 55)], fill=0)
    draw.text((25, HEIGHT - 45), "👉 Touch Pin 8 again to exit diagnostics and trigger a manual screen refresh.", fill=0, font=font_medium)
    draw.text((25, HEIGHT - 28), "   Diagnostics overlay will automatically exit in 15 seconds.", fill=0, font=font_medium)
    
    if config.DISPLAY_TYPE == 'waveshare':
        display_waveshare(img)
    elif config.DISPLAY_TYPE == 'inky':
        display_inky(img)
    else:
        display_mock(img)

def poll_server():
    """Main fetch loop"""
    # Dynamically resolve MAC address if configured to do so or if empty
    device_id = getattr(config, 'DEVICE_ID', 'dynamic_mac')
    if device_id == 'dynamic_mac' or not device_id:
        print("[WiFi] Resolving dynamic hardware MAC address for device registration...")
        device_id = get_mac_address()

    server_url = f"http://{config.SERVER_IP}:{config.SERVER_PORT}/api/display/raw"
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
    
    last_poll_time = 0
    poll_interval = getattr(config, 'DEFAULT_POLL_INTERVAL', 1800)
    force_refresh = True
    next_action = None
    last_successful_sync_time = 0
    consecutive_failures = 0
    offline_index = -1
    
    diagnostics_active = False
    diagnostics_start_time = 0

    # Track MPR121 pin state to detect transition (rising edge)
    prev_touched = False
    next_touched = False
    setup_touched = False
    diag_touched = False

    while True:
        # Prevent high-frequency spinning under unexpected execution paths/errors
        time.sleep(0.1)
        current_time = time.time()
        
        # Check if diagnostics screen timed out
        if diagnostics_active and (current_time - diagnostics_start_time >= 15.0):
            print(f"[{time.strftime('%H:%M:%S')}] Diagnostics overlay timed out after 15 seconds. Triggering manual refresh...")
            diagnostics_active = False
            force_refresh = True
        
        # Check MPR121 touch inputs if enabled and initialized
        if mpr121 is not None:
            try:
                prev_pin = getattr(config, 'MPR121_PREV_PIN', 6)
                next_pin = getattr(config, 'MPR121_NEXT_PIN', 7)
                setup_pin = getattr(config, 'MPR121_SETUP_PIN', 9)
                diagnostics_pin = getattr(config, 'MPR121_DIAG_PIN', 8)
                
                curr_prev_state = mpr121[prev_pin].value
                curr_next_state = mpr121[next_pin].value
                curr_setup_state = mpr121[setup_pin].value
                curr_diag_state = mpr121[diagnostics_pin].value
                
                # Check for rising edge (off -> on)
                if curr_prev_state and not prev_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] 👈 Previous Screen Button (Pin {prev_pin}) touched!")
                    force_refresh = True
                    next_action = 'prev'
                elif curr_next_state and not next_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] 👉 Next Screen Button (Pin {next_pin}) touched!")
                    force_refresh = True
                    next_action = 'next'
                elif curr_setup_state and not setup_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] ⚙️ Setup/AP Mode Button (Pin {setup_pin}) touched! Entering AP setup portal...")
                    enter_ap_setup_mode()
                elif curr_diag_state and not diag_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] 📊 Diagnostics Button (Pin {diagnostics_pin}) touched!")
                    if not diagnostics_active:
                        diagnostics_active = True
                        diagnostics_start_time = time.time()
                        draw_diagnostics_overlay(last_successful_sync_time)
                    else:
                        diagnostics_active = False
                        force_refresh = True
                        print(f"[{time.strftime('%H:%M:%S')}] Exiting diagnostics, triggering manual refresh...")
                
                prev_touched = curr_prev_state
                next_touched = curr_next_state
                setup_touched = curr_setup_state
                diag_touched = curr_diag_state
            except Exception as e:
                print(f"[Warning] Error reading MPR121 pins: {e}")
                
        # Check if we should poll the server
        if not diagnostics_active and (force_refresh or (current_time - last_poll_time >= poll_interval)):
            action_to_send = next_action
            force_refresh = False
            next_action = None
            
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

                # Prepare query parameters
                request_params = params.copy()
                if action_to_send:
                    request_params['action'] = action_to_send
                    request_params['force'] = 'true'
                    print(f"[{time.strftime('%H:%M:%S')}] Triggering action: {action_to_send}")

                response = requests.get(server_url, params=request_params, headers=headers, stream=True, timeout=10)
                
                if response.status_code != 200:
                    print(f"[Server Warning] Server responded with status code: {response.status_code}")
                    response.close()
                    raise requests.exceptions.RequestException(f"Bad status code {response.status_code}")
                
                consecutive_failures = 0  # Reset on successful request
                
                carousel_sig = response.headers.get('X-Carousel-Signature')
                image_index_val = response.headers.get('X-Image-Index')
                total_images_val = response.headers.get('X-Total-Images')
                refresh_rate_val = response.headers.get('X-Refresh-Rate')
                
                # Try to parse refresh rate from header, fallback to configuration
                if refresh_rate_val:
                    try:
                        poll_interval = int(refresh_rate_val)
                        print(f"[{time.strftime('%H:%M:%S')}] Server set refresh rate: {poll_interval}s")
                    except ValueError:
                        pass
                
                image_index = None
                total_images = None
                if image_index_val is not None:
                    try:
                        image_index = int(image_index_val)
                    except ValueError:
                        pass
                if total_images_val is not None:
                    try:
                        total_images = int(total_images_val)
                    except ValueError:
                        pass
                
                is_cached = False
                raw_bytes = None
                
                if carousel_sig and image_index is not None:
                    manifest = read_cache_manifest()
                    if manifest.get('carousel_signature') != carousel_sig:
                        print(f"[{time.strftime('%H:%M:%S')}] 🔄 Carousel signature mismatch. Invalidating local cache...")
                        clear_cache_slides()
                        manifest = {
                            'carousel_signature': carousel_sig,
                            'total_images': total_images or 1,
                            'width': WIDTH,
                            'height': HEIGHT
                        }
                        write_cache_manifest(manifest)
                        
                    raw_bytes = get_cached_slide(image_index)
                    if raw_bytes is not None:
                        is_cached = True
                        print(f"[{time.strftime('%H:%M:%S')}] 💾 Cache hit! Loading Slide {image_index} from local storage...")
                        response.close()
                
                if not is_cached:
                    try:
                        raw_bytes = response.content
                    finally:
                        response.close()
                    
                    print(f"[{time.strftime('%H:%M:%S')}] Image downloaded successfully ({len(raw_bytes)} bytes)")
                    
                    # Safety Padding/Truncating Catch
                    expected_size = int((WIDTH * HEIGHT) / 8)
                    if len(raw_bytes) < expected_size:
                        missing = expected_size - len(raw_bytes)
                        print(f"[{time.strftime('%H:%M:%S')}] ⚠️  [Padding] Stream truncated. Received {len(raw_bytes)} bytes, expected {expected_size}. Padding with {missing} bytes of white...")
                        raw_bytes += b'\xff' * missing
                    elif len(raw_bytes) > expected_size:
                        print(f"[{time.strftime('%H:%M:%S')}] ⚠️  [Truncate] Received {len(raw_bytes)} bytes, expected {expected_size}. Truncating to fit screen size...")
                        raw_bytes = raw_bytes[:expected_size]
                    
                    if carousel_sig and image_index is not None:
                        save_cached_slide(image_index, raw_bytes)
                        print(f"[{time.strftime('%H:%M:%S')}] 💾 Saved Slide {image_index} to local disk cache.")
                
                last_successful_sync_time = time.time()
                
                # Direct to selected driver
                if config.DISPLAY_TYPE == 'waveshare':
                    display_waveshare(raw_bytes)
                elif config.DISPLAY_TYPE == 'inky':
                    display_inky(raw_bytes)
                else:
                    display_mock(raw_bytes)
                
                # Update last poll time only on a successful attempt
                last_poll_time = time.time()
                
                # Print sleeping status info
                poll_interval = max(1, poll_interval)
                print(f"💤 Waiting {poll_interval} seconds or until button press...\n")
                
            except (requests.exceptions.RequestException, Exception) as e:
                consecutive_failures += 1
                is_req_err = isinstance(e, requests.exceptions.RequestException)
                err_label = "Connection Error" if is_req_err else "Unexpected Error"
                print(f"[{time.strftime('%H:%M:%S')}] ⚠️  [{err_label}] {e}")
                
                # Try offline carousel fallback
                manifest = read_cache_manifest()
                total_cached = manifest.get('total_images', 0)
                carousel_sig = manifest.get('carousel_signature')
                
                rotated_offline = False
                if total_cached > 0 and carousel_sig:
                    offline_index = (offline_index + 1) % total_cached
                    raw_bytes = get_cached_slide(offline_index)
                    if raw_bytes is not None:
                        print(f"[{time.strftime('%H:%M:%S')}] 📡 [Offline Mode] Server unreachable. Rotating to cached Slide {offline_index} (total: {total_cached})...")
                        if config.DISPLAY_TYPE == 'waveshare':
                            display_waveshare(raw_bytes)
                        elif config.DISPLAY_TYPE == 'inky':
                            display_inky(raw_bytes)
                        else:
                            display_mock(raw_bytes)
                        rotated_offline = True
                
                if consecutive_failures >= 3:
                    print(f"[{time.strftime('%H:%M:%S')}] ⚠️  {consecutive_failures} consecutive sync failures. Triggering automatic diagnostics overlay...")
                    draw_diagnostics_overlay(last_successful_sync_time)
                    last_poll_time = time.time()
                    poll_interval = 30  # Polling with 30s delay to prevent spamming
                else:
                    # Retry in 10 seconds
                    print(f"Retrying in 10 seconds (consecutive failures: {consecutive_failures})...")
                    last_poll_time = time.time() - poll_interval + 10

if __name__ == "__main__":
    try:
        poll_loop_interval = poll_server()
    except KeyboardInterrupt:
        print("\n👋 Client polling terminated. Exiting.")
        sys.exit(0)
