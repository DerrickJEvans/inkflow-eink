#!/usr/bin/env python3
# test_4gray.py - E-Ink 4-Level Grayscale Test Script for Waveshare 7.5" V2
import os
import sys
import time
from PIL import Image, ImageDraw, ImageFont

# Ensure we can import modules from the local client directory
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

try:
    import config
    import drivers
except ImportError as e:
    print(f"[Error] Failed to import client config or drivers: {e}")
    sys.exit(1)

def get_fonts():
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
    ]
    font = None
    for p in paths:
        try:
            if os.path.exists(p):
                font = ImageFont.truetype(p, 24)  # 24pt bold/regular font
                break
        except Exception:
            pass
    if font is None:
        font = ImageFont.load_default()
        print("\n[Warning] No system TrueType font found! Falling back to standard low-res bitmap font.")
        print("          This default font is very small (9px) with thin 1-pixel lines, which")
        print("          will cause streaks and look fuzzy in 4-gray mode.")
        print("          👉 Fix: Run 'sudo apt-get install -y fonts-dejavu' on your Raspberry Pi.")
        print("                  Then run this test again to see clean, crisp text.\n")
    return font

def main():
    model = drivers.WAVESHARE_MODEL or 'epd7in5_V2'
    print(f"============================================================")
    print(f"         INKFLOW 4-LEVEL GRAYSCALE HARDWARE TEST            ")
    print(f"============================================================")
    print(f"Targeting Waveshare EPD Driver model: {model}")
    print("This script will render a test pattern with 4 vertical/horizontal")
    print("bands representing White, Light Gray, Dark Gray, and Black.")
    print("------------------------------------------------------------\n")
    
    if config.DISPLAY_TYPE != 'waveshare':
        print("[Notice] DISPLAY_TYPE is not set to 'waveshare' in .env.")
        print("This tool will generate a mockup PNG file instead.")
        print("")

    # 1. Dynamically import driver
    epd = None
    if config.DISPLAY_TYPE == 'waveshare':
        try:
            print(f"[Hardware] Loading driver module: waveshare_epd.{model}...")
            epd_module = __import__(f"waveshare_epd.{model}", fromlist=["EPD"])
            epd = epd_module.EPD()
        except Exception as e:
            print(f"[Error] Failed to load driver waveshare_epd.{model}: {e}")
            sys.exit(1)

    width = epd.width if epd else drivers.WIDTH
    height = epd.height if epd else drivers.HEIGHT

    print(f"[Image] Creating {width}x{height} grayscale test pattern...")
    # Grayscale ('L' mode) image
    img = Image.new('L', (width, height), 255)
    draw = ImageDraw.Draw(img)
    font = get_fonts()

    # Define 4 bands of equal height
    band_h = height // 4
    
    # Colors: White (255), Light Gray (192), Dark Gray (128), Black (0)
    # These match the exact mapping thresholds in getbuffer_4Gray
    bands = [
        {"color": 255, "label": "SHADE 1: WHITE (Value 255 / 0xFF)", "text_color": 0},
        {"color": 192, "label": "SHADE 2: LIGHT GRAY (Value 192 / 0xC0)", "text_color": 0},
        {"color": 128, "label": "SHADE 3: DARK GRAY (Value 128 / 0x80)", "text_color": 255},
        {"color": 0,   "label": "SHADE 4: BLACK (Value 0 / 0x00)", "text_color": 255}
    ]

    for idx, band in enumerate(bands):
        y_start = idx * band_h
        y_end = (idx + 1) * band_h if idx < len(bands) - 1 else height
        
        # Draw solid background band
        draw.rectangle([0, y_start, width, y_end], fill=band["color"])
        
        # Draw label text centered vertically inside the band
        text_y = y_start + (band_h // 2) - 15
        draw.text((30, text_y), band["label"], fill=band["text_color"], font=font)
        
        # Draw a solid high-contrast vertical bar on the right side for transition verification (no fuzzy outlines)
        bar_w = 50
        bar_x_start = width - 100
        bar_x_end = width - 50
        bar_y_start = y_start + 20
        bar_y_end = y_end - 20
        draw.rectangle([bar_x_start, bar_y_start, bar_x_end, bar_y_end], fill=band["text_color"])

    # 2. Render image
    if epd:
        try:
            # Check if driver supports 4-level grayscale
            if not hasattr(epd, 'init_4Gray') or not hasattr(epd, 'display_4Gray'):
                print("[Error] This Waveshare driver model does NOT support 4-level grayscale!")
                print("Attributes 'init_4Gray' and/or 'display_4Gray' are missing.")
                sys.exit(1)

            # Clean display first to prevent ghosting/streaking from previous screen
            print("[Hardware] Initializing Waveshare EPD in standard mode to perform a clean refresh...")
            epd.init()
            print("[Hardware] Clearing screen to pristine white to avoid ghosting...")
            epd.Clear()

            print("[Hardware] Initializing Waveshare EPD in 4-Level Grayscale mode (init_4Gray)...")
            epd.init_4Gray()

            print("[Hardware] Processing PIL image into 4-gray buffer and displaying...")
            buffer = epd.getbuffer_4Gray(img)
            epd.display_4Gray(buffer)

            # Sleep delay
            sleep_delay = getattr(config, 'SLEEP_DELAY', 6.0)
            if sleep_delay > 0:
                print(f"[Hardware] Waiting {sleep_delay} seconds for screen voltages to settle...")
                time.sleep(sleep_delay)

            print("[Hardware] Putting screen to sleep...")
            epd.sleep()

            # Apply low-leakage state shutdown
            try:
                import waveshare_epd.epdconfig as epdconfig
                impl = getattr(epdconfig, 'implementation', None)
                print("[Hardware] Setting EPD control pins to low-leakage state...")
                drivers.set_pin_value(impl, 'CS_PIN', 1)
                drivers.set_pin_value(impl, 'RST_PIN', 0)
                drivers.set_pin_value(impl, 'DC_PIN', 0)
                drivers.set_pin_value(impl, 'PWR_PIN', 0)
                
                spi_obj = getattr(impl, 'SPI', None) or getattr(epdconfig, 'SPI', None)
                if spi_obj is not None and hasattr(spi_obj, 'close'):
                    spi_obj.close()
                    print("[Hardware] SPI interface closed.")
            except Exception as gpio_err:
                print(f"[Warning] Failed to set low-leakage pin state: {gpio_err}")

            print("\n[SUCCESS] Grayscale test pattern successfully written to display!")
            
        except Exception as e:
            print(f"[Error] Hardware failure during grayscale render: {e}")
            sys.exit(1)
    else:
        # Mock file preview fallback
        preview_filename = "debug_4gray_preview.png"
        img.save(preview_filename)
        print(f"[Mock] Image saved to local file: {os.path.abspath(preview_filename)}")
        drivers.render_ascii_preview(img)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[Exit] Grayscale test terminated by user.")
        sys.exit(0)
