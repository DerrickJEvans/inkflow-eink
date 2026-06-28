# drivers.py - E-Paper Display Hardware Drivers and Previews for Python Client
import time
import os
import sys
from PIL import Image, ImageOps
import config

# Dynamic Display Resolution & Model resolution based on SCREEN_TYPE
SCREEN_DEFINITIONS = {
    '4in26': (800, 480, 'epd4in26'),
    '7in5':  (800, 480, 'epd7in5_V2'),
    '4in2':  (400, 300, 'epd4in2'),
    '2in9':  (296, 128, 'epd2in9')
}

screen_type = getattr(config, 'SCREEN_TYPE', '4in26')
default_w, default_h, default_model = SCREEN_DEFINITIONS.get(screen_type, (800, 480, 'epd4in26'))

WIDTH = getattr(config, 'WIDTH', None) or default_w
HEIGHT = getattr(config, 'HEIGHT', None) or default_h
WAVESHARE_MODEL = getattr(config, 'WAVESHARE_MODEL', None) or default_model
DEVICE_NAME = getattr(config, 'DEVICE_NAME', 'InkFlow Python Client')

def send_cmd(epd, command):
    """Dynamic command sender compatible with Waveshare naming variations"""
    for method_name in ['send_command', 'SendCommand']:
        if hasattr(epd, method_name):
            getattr(epd, method_name)(command)
            return
    raise AttributeError("EPD object lacks command sender")

def send_val(epd, data):
    """Dynamic data/value sender compatible with Waveshare naming variations"""
    for method_name in ['send_data', 'SendData']:
        if hasattr(epd, method_name):
            getattr(epd, method_name)(data)
            return
    raise AttributeError("EPD object lacks data sender")

def wait_busy(epd):
    """Dynamic busy state reader compatible with Waveshare naming variations"""
    for method_name in ['ReadBusy', 'read_busy', 'wait_busy']:
        if hasattr(epd, method_name):
            getattr(epd, method_name)()
            return

def render_ascii_preview(img):
    """Renders a quick low-res ASCII thumbnail of the e-ink screen in terminal logs."""
    try:
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
    except Exception:
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

def init_trmnl_hardware_7in5(epd):
    """
    Performs register-level hardware initialization matching the C++ driver.
    Crucial to configure booster/voltages BEFORE turning on power (0x04) to avoid charge pump crashes.
    """
    print("[Hardware Display] Executing custom C++ TRMNL hardware initialization sequence...")
    
    import waveshare_epd.epdconfig as epdconfig
    if epdconfig.module_init() != 0:
        raise IOError("Waveshare SPI/GPIO module_init failed")
        
    # 1. Reset EPD controller
    for method_name in ['reset', 'Reset']:
        if hasattr(epd, method_name):
            getattr(epd, method_name)()
            break
            
    # 2. Power setting
    send_cmd(epd, 0x01)
    send_val(epd, 0x17)
    send_val(epd, 0x17)  # VGH/VGL voltage
    send_val(epd, 0x3F)  # VSH
    send_val(epd, 0x3F)  # VSL
    send_val(epd, 0x11)  # VSHR
    
    # 3. VCOM DC Setting
    send_cmd(epd, 0x82)
    send_val(epd, 0x24)
    
    # 4. Booster Setting
    send_cmd(epd, 0x06)
    send_val(epd, 0x27)
    send_val(epd, 0x27)
    send_val(epd, 0x2F)
    send_val(epd, 0x17)
    
    # 5. OSC Setting (frequency adjustment)
    send_cmd(epd, 0x30)
    send_val(epd, 0x06)
    
    # 6. Power On
    send_cmd(epd, 0x04)
    time.sleep(0.1)
    wait_busy(epd)
    
    # 7. Panel Setting
    send_cmd(epd, 0x00)
    send_val(epd, 0x3F)
    
    # 8. Resolution Setting (tres)
    send_cmd(epd, 0x61)
    send_val(epd, 0x03)  # source 800
    send_val(epd, 0x20)
    send_val(epd, 0x01)  # gate 480
    send_val(epd, 0xE0)
    
    # 9. Dual-stage Resolution config
    send_cmd(epd, 0x15)
    send_val(epd, 0x00)
    
    # 10. VCOM and Data Interval Setting
    send_cmd(epd, 0x50)
    send_val(epd, 0x10)
    send_val(epd, 0x00)  # Match C++ border setting (0x00) to prevent charge traps
    
    # 11. TCON Setting
    send_cmd(epd, 0X60)
    send_val(epd, 0x22)
    
    # 12. Resolution Setting (second round)
    send_cmd(epd, 0x65)
    send_val(epd, 0x00)
    send_val(epd, 0x00)
    send_val(epd, 0x00)
    send_val(epd, 0x00)

def display_waveshare(img, partial=False, sleep_after=True):
    """Pushes image to Waveshare SPI E-Paper display"""
    model = WAVESHARE_MODEL
    print(f"[Hardware Display] Loading Waveshare EPD driver: {model}")
    try:
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
        
        # Check for fast full-frame (non-flashing) refresh capabilities in the driver.
        # Priority order:
        #   1. Fast LUT display methods (display_Fast / display_fast) - drives ALL pixels
        #      to new state without the standard flash cycle. Correct for full-image replacement.
        #      Note: some drivers (e.g. epd4in26) have display_fast but no init_fast — the
        #      standard epd.init() wake-up is sufficient in those cases.
        #   2. Partial region methods (init_Partial / display_Partial) - only drives
        #      *changed* pixels. Fast but causes ghost trails on complex full-image swaps.
        init_part_func = None    # Optional separate mode-init (may be None for fast mode)
        display_part_func = None
        fast_mode = False        # True when using Fast LUT, False when using Partial region

        # 1. Try Fast LUT display method first
        for display_name in ['display_Fast', 'display_fast', 'displayFast']:
            if hasattr(epd, display_name):
                display_part_func = getattr(epd, display_name)
                fast_mode = True
                break

        # 1b. Also look for an optional dedicated fast init (not all drivers have one)
        if fast_mode:
            for init_name in ['init_Fast', 'init_fast', 'init_4Gray', 'init_fast_refresh']:
                if hasattr(epd, init_name):
                    init_part_func = getattr(epd, init_name)
                    break

        # 2. Fall back to Partial region methods if no Fast LUT display found
        if not fast_mode:
            for init_name in ['init_Partial', 'init_part', 'init_part_refresh']:
                if hasattr(epd, init_name):
                    init_part_func = getattr(epd, init_name)
                    break
            for display_name in ['display_Partial', 'display_Part', 'display_part']:
                if hasattr(epd, display_name):
                    display_part_func = getattr(epd, display_name)
                    break

        # Fast mode only needs a display method (init is handled by epd.init() wake-up).
        # Partial region mode needs both init and display methods.
        if fast_mode:
            has_partial_support = display_part_func is not None
        else:
            has_partial_support = (init_part_func is not None and display_part_func is not None)

        refresh_mode_label = "Fast LUT (no-flash full frame)" if fast_mode else "Partial region"
        if has_partial_support:
            print(f"[Hardware Display] Fast refresh mode available: {refresh_mode_label}")
        else:
            print("[Hardware Display] No fast/partial refresh support found. Full refresh will always be used.")

        # Force full refresh if no fast/partial updates are supported by the driver
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
            if not getattr(config, 'INVERT_COLORS', False):
                buffer = [~b & 0xFF for b in img]
            else:
                buffer = list(img)
        else:
            processed_img = img.convert("L").resize((epd.width, epd.height))
            if getattr(config, 'INVERT_COLORS', False):
                print("[Hardware Display] Inverting color bits...")
                processed_img = ImageOps.invert(processed_img)
            mono_img = processed_img.convert("1")
            buffer = epd.getbuffer(mono_img)
        
        if actual_partial:
            mode_label = "Fast LUT" if fast_mode else "Partial region"
            print(f"[Hardware Display] Initializing Waveshare EPD ({mode_label} refresh)...")
            try:
                epd.init()  # Wake controller from deep sleep (required before any update)
            except Exception as init_err:
                print(f"[Warning] epd.init() failed before fast/partial update: {init_err}")
            if init_part_func is not None:
                # Call mode-specific init only when the driver provides one
                init_part_func()
            print(f"[Hardware Display] Writing frame buffer ({mode_label})...")
            
            import inspect
            try:
                sig = inspect.signature(display_part_func)
                params = list(sig.parameters.keys())
                print(f"[Hardware Display] EPD display_part_func signature: {sig} (parameters: {params})")
                
                if len(params) >= 5:
                    args = {}
                    for p in params:
                        p_lower = p.lower()
                        if 'image' in p_lower or 'buffer' in p_lower or 'img' in p_lower:
                            args[p] = buffer
                        elif 'xstart' in p_lower:
                            args[p] = 0
                        elif 'ystart' in p_lower:
                            args[p] = 0
                        elif 'xend' in p_lower:
                            args[p] = epd.width
                        elif 'yend' in p_lower:
                            args[p] = epd.height
                        else:
                            args[p] = 0
                    display_part_func(**args)
                else:
                    display_part_func(buffer)
            except Exception as sig_err:
                print(f"[Warning] Failed to call display_part_func via keyword inspection: {sig_err}. Trying positional fallbacks...")
                try:
                    display_part_func(buffer)
                except TypeError:
                    try:
                        # Image first: (Image, Xstart, Ystart, Xend, Yend)
                        display_part_func(buffer, 0, 0, epd.width, epd.height)
                    except TypeError:
                        # Coordinates first: (Xstart, Ystart, Xend, Yend, Image)
                        display_part_func(0, 0, epd.width, epd.height, buffer)
        else:
            print("[Hardware Display] Initializing Waveshare EPD (Full Refresh)...")
            epd.init()
            
            # Apply border data interval override to prevent edge fading (match C++ driver)
            try:
                send_cmd(epd, 0x50)
                send_val(epd, 0x10)
                send_val(epd, 0x00) # 0x00 disables border current draw, preventing edge voltage drop
                print("[Hardware Display] Border interval optimized to 0x00 (floating border).")
            except Exception as e:
                print(f"[Warning] Failed to optimize border: {e}")
                
            print("[Hardware Display] Writing full frame buffer to display...")
            epd.display(buffer)
            
        if actual_sleep_after:
            sleep_delay = getattr(config, 'SLEEP_DELAY', 6.0)
            if sleep_delay > 0:
                print(f"[Hardware Display] Waiting {sleep_delay} seconds for screen voltages to settle...")
                time.sleep(sleep_delay)
            print("[Hardware Display] Putting screen to sleep...")
            epd.sleep()
            print("[Hardware Display] Draw cycle complete (screen put to sleep).")
        else:
            print("[Hardware Display] Draw cycle complete (screen kept awake for subsequent updates).")
    except ImportError:
        print(f"[Error] Waveshare drivers not found for model '{model}'!")
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
        processed_img = img.resize(inky_display.resolution).convert("L")
        inky_display.set_image(processed_img)
        print("[Hardware Display] Pushing frame buffer...")
        inky_display.show()
        print("[Hardware Display] Draw cycle complete.")
    except ImportError:
        print("[Error] Pimoroni Inky library not found! Falling back to local mockup preview file.")
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
