#!/usr/bin/env python3
# diagnose_display.py - E-Ink Hardware Diagnostic Test Suite for 7.5" screens
# Helps troubleshoot screen fading by cycling through reference patterns and refresh combinations.

import os
import sys
import time
import argparse
from PIL import Image, ImageDraw, ImageFont, ImageOps

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
    """Attempts to load common Linux system fonts, falling back to default."""
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf"
    ]
    font_large = None
    font_medium = None
    for p in paths:
        try:
            if os.path.exists(p):
                font_large = ImageFont.truetype(p, 18)
                font_medium = ImageFont.truetype(p, 13)
                break
        except Exception:
            pass
    if font_large is None:
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
    return font_large, font_medium


def make_checkerboard(width, height, box_size):
    """Generates a high-contrast pixel checkerboard pattern at block size `box_size`."""
    small_w = (width + box_size - 1) // box_size
    small_h = (height + box_size - 1) // box_size
    
    # 2x2 tiling base
    base = Image.new("L", (2, 2))
    base.putpixel((0, 0), 0)    # black
    base.putpixel((1, 0), 255)  # white
    base.putpixel((0, 1), 255)  # white
    base.putpixel((1, 1), 0)    # black
    
    # Tile it over (small_w, small_h)
    tiled = Image.new("L", (small_w, small_h))
    for y in range(0, small_h, 2):
        for x in range(0, small_w, 2):
            tiled.paste(base, (x, y))
            
    # Resize to screen resolution using NEAREST (no filtering/blurring)
    return tiled.resize((width, height), Image.NEAREST)


def generate_world_clock_sim(width, height, night_mode="hatch", time_str="12:00", font_large=None, font_medium=None):
    """Simulates the visual layout of the World Clock map plugin for testing."""
    img = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(img)
    
    # Draw map border
    map_x, map_y = 40, 80
    map_w, map_h = width - 80, height - 185
    draw.rectangle([map_x, map_y, map_x + map_w, map_y + map_h], outline=0, width=2)
    
    # Draw simple blocky representation of world landmasses
    # North America
    draw.rectangle([map_x + 30, map_y + 20, map_x + 120, map_y + 60], fill=180)
    # South America
    draw.rectangle([map_x + 60, map_y + 60, map_x + 100, map_y + 110], fill=180)
    # Eurasia
    draw.rectangle([map_x + 160, map_y + 15, map_x + 280, map_y + 65], fill=180)
    # Africa
    draw.rectangle([map_x + 170, map_y + 65, map_x + 210, map_y + 110], fill=180)
    # Australia
    draw.rectangle([map_x + 260, map_y + 85, map_x + 300, map_y + 115], fill=180)
    
    # Night zone on the right half of the map
    night_x = map_x + map_w // 2
    night_y = map_y
    night_w = map_w // 2
    night_h = map_h
    
    if night_mode == "hatch":
        # Draw 45-degree parallel diagonal hatch lines
        hatch_img = Image.new("L", (night_w, night_h), 255)
        hatch_draw = ImageDraw.Draw(hatch_img)
        spacing = 8
        for offset in range(-night_h, night_w, spacing):
            hatch_draw.line([(offset, 0), (offset + night_h, night_h)], fill=0, width=1)
        
        # Paste lines over map using inverted hatch image as transparency mask
        mask = ImageOps.invert(hatch_img)
        black_tile = Image.new("L", (night_w, night_h), 0)
        img.paste(black_tile, (night_x, night_y), mask=mask)
        
    elif night_mode == "solid_checkerboard":
        # 2x2 checkerboard overlay simulating night land in 'solid' mode
        checker = make_checkerboard(night_w, night_h, 2)
        img.paste(checker, (night_x, night_y))
        
    elif night_mode == "dots":
        # Renders outline circles representing dots mode
        for cy in range(night_y + 6, night_y + night_h, 12):
            for cx in range(night_x + 6, night_x + night_w, 12):
                draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], outline=0, width=1)
                
    # Draw simulated digital clocks underneath
    draw.text((map_x, map_y + map_h + 15), f"LONDON: {time_str}", fill=0, font=font_large)
    draw.text((map_x + 190, map_y + map_h + 15), "TOKYO: 20:00", fill=0, font=font_medium)
    draw.text((map_x + 340, map_y + map_h + 15), "NEW YORK: 07:00", fill=0, font=font_medium)
    
    # Bottom metadata bar
    draw.line([20, height - 35, width - 20, height - 35], fill=0, width=1)
    draw.text((30, height - 25), "World Clock Simulator - Diagnostics Mode", fill=0, font=font_medium)
    
    return img


def make_solid_test_card(w, h, color, title, subtitle, fl, fm):
    img = Image.new("L", (w, h), color)
    draw = ImageDraw.Draw(img)
    header_color = 0 if color == 255 else 255
    text_color = 255 if color == 255 else 0
    draw.rectangle([0, 0, w, 60], fill=header_color)
    draw.text((20, 10), title, fill=text_color, font=fl)
    draw.text((20, 35), subtitle, fill=text_color, font=fm)
    return img


def make_shape_test_card(w, h, step, title, fl, fm):
    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w, 60], fill=0)
    draw.text((20, 10), title, fill=255, font=fl)
    draw.text((20, 35), "Draws a solid circle. Watch if the circle fades or leaves ghosting.", fill=255, font=fm)
    
    cx = w // 2
    cy = (h + 60) // 2
    r = 80
    if step == 2:
        cx += 40  # move circle for partial refresh test
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)
    return img


def make_pattern_test_card(w, h, pattern_type, scale, title, fl, fm):
    if pattern_type == "checkerboard":
        img = make_checkerboard(w, h, scale)
    elif pattern_type == "checkerboard_inverted":
        img = ImageOps.invert(make_checkerboard(w, h, scale))
    else:
        img = Image.new("L", (w, h), 255)
        
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w, 60], fill=255)
    draw.text((20, 10), title, fill=0, font=fl)
    draw.text((20, 35), f"Pattern: {pattern_type} (cell size: {scale}px)", fill=0, font=fm)
    return img


def make_world_clock_test_card(w, h, night_mode, time_str, title, fl, fm):
    img = generate_world_clock_sim(w, h, night_mode, time_str, fl, fm)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w, 60], fill=0)
    draw.text((20, 10), title, fill=255, font=fl)
    draw.text((20, 35), f"Mode: {night_mode} | Time: {time_str}", fill=255, font=fm)
    return img


# List of diagnostic test definitions
def get_test_sequence():
    return [
        # Series A: Solid Colors & Standard Refreshes
        {
            "id": "A1",
            "name": "Solid Black (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_solid_test_card(w, h, 0, "TEST A1: Solid Black (Full Refresh + Sleep)", "Screen should be solid black below this bar.", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Displays a solid black screen. Verifies full-refresh capability and subsequent pin sleep."
        },
        {
            "id": "A2",
            "name": "Solid White (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_solid_test_card(w, h, 255, "TEST A2: Solid White (Full Refresh + Sleep)", "Screen should be solid white below this bar.", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Cleans the previous black screen. Verifies standard white state."
        },
        
        # Series B: Checkerboard Resolution Scale
        {
            "id": "B1",
            "name": "1x1 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 1, "TEST B1: 1x1 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 20,
            "desc": "Alternating 1x1 pixels (highest frequency). Check if this fades over the 20s wait."
        },
        {
            "id": "B2",
            "name": "2x2 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 2, "TEST B2: 2x2 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates a 2x2 block checkerboard pattern under full refresh and sleep."
        },
        {
            "id": "B3",
            "name": "4x4 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 4, "TEST B3: 4x4 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates a 4x4 block checkerboard pattern under full refresh and sleep."
        },
        {
            "id": "B4",
            "name": "8x8 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 8, "TEST B4: 8x8 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates an 8x8 block checkerboard pattern under full refresh and sleep."
        },
        {
            "id": "B5",
            "name": "16x16 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 16, "TEST B5: 16x16 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates a 16x16 block checkerboard pattern under full refresh and sleep."
        },
        {
            "id": "B6",
            "name": "32x32 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 32, "TEST B6: 32x32 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates a 32x32 block checkerboard pattern under full refresh and sleep."
        },
        {
            "id": "B7",
            "name": "64x64 Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_pattern_test_card(w, h, "checkerboard", 64, "TEST B7: 64x64 Checkerboard (Full Refresh + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 15,
            "desc": "Generates a 64x64 block checkerboard pattern under full refresh and sleep."
        },
        
        # Series C: World Clock Simulations
        {
            "id": "C1",
            "name": "World Clock Hatch (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_world_clock_test_card(w, h, "hatch", "12:00", "TEST C1: World Clock Hatch (Full + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 25,
            "desc": "Simulates the hires World Clock map (diagonal hatch lines). Watch for line fading/breakup over 25s."
        },
        {
            "id": "C2",
            "name": "World Clock Solid-Checkerboard (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_world_clock_test_card(w, h, "solid_checkerboard", "12:00", "TEST C2: World Clock Solid-Checkerboard (Full + Sleep)", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 25,
            "desc": "Simulates the solid World Clock map (2x2 checkerboard night land). Watch for fading over 25s."
        },
        
        # Final Clear
        {
            "id": "Clean",
            "name": "Solid White Clean (Full Refresh + Sleep)",
            "generator": lambda w, h, fl, fm: make_solid_test_card(w, h, 255, "DIAGNOSTICS COMPLETE", "Screen cleared to solid white.", fl, fm),
            "partial": False,
            "sleep": True,
            "wait": 5,
            "desc": "Cleans the screen to a pristine solid white at the end of the test sequence."
        }
    ]


def safe_input(prompt):
    """Safely prompts for input, handling EOFError gracefully in non-TTY environments."""
    try:
        return input(prompt)
    except EOFError:
        print("[Notice] Non-interactive environment detected, proceeding automatically...")
        return ""


def main():
    parser = argparse.ArgumentParser(description="E-Ink Hardware Diagnostic Test Suite")
    parser.add_argument("--delay", type=float, default=None, help="Force a fixed delay (in seconds) between all test patterns")
    parser.add_argument("--step-by-step", action="store_true", help="Pause and wait for keypress to advance between each test pattern")
    args = parser.parse_args()

    width = drivers.WIDTH
    height = drivers.HEIGHT
    model = drivers.WAVESHARE_MODEL
    display_type = config.DISPLAY_TYPE

    print("============================================================")
    print("           INKFLOW E-INK DISPLAY DIAGNOSTIC TOOL            ")
    print("============================================================")
    print(f"This tool cycles through visual patterns to diagnose screen fading.")
    print(f"Test patterns draw descriptive banners directly on screen, so you")
    print(f"can record the display on your phone to capture the failure.")
    print("")
    print(f"Detected Display Configuration:")
    print(f"  |-- Screen Type:        {config.SCREEN_TYPE}")
    print(f"  |-- Display Type:       {display_type}")
    print(f"  |-- Hardware Resolution: {width}x{height}")
    print(f"  +-- Waveshare Model:    {model or 'N/A'}")
    print("")
    
    if display_type != 'waveshare':
        print("[Notice] DISPLAY_TYPE is not set to 'waveshare' in .env.")
        print("This diagnostic tool will output PNG files to the local directory.")
        print("")
        
    font_large, font_medium = get_fonts()
    tests = get_test_sequence()
    
    print(f"Loaded {len(tests)} test patterns in sequence.")
    print("------------------------------------------------------------")
    print("Please position your phone to record the e-ink screen now.")
    safe_input("Press Enter to begin the diagnostic test sequence...")
    print("------------------------------------------------------------\n")

    for i, t in enumerate(tests):
        print(f"[{i + 1}/{len(tests)}] Running Test {t['id']}: {t['name']}")
        print(f"  |-- Refresh Mode: {'PARTIAL (fast refresh)' if t['partial'] else 'FULL (flashing refresh)'}")
        print(f"  |-- Screen Sleep: {'YES (put to sleep after draw)' if t['sleep'] else 'NO (keep pins active)'}")
        print(f"  +-- Description:  {t['desc']}")
        
        # 1. Generate the test card image
        img = t['generator'](width, height, font_large, font_medium)
        
        # 2. Push to screen
        try:
            if display_type == 'waveshare':
                # Call display_waveshare directly
                drivers.display_waveshare(img, partial=t['partial'], sleep_after=t['sleep'])
            elif display_type == 'inky':
                drivers.display_inky(img)
            else:
                drivers.display_mock(img)
        except Exception as e:
            print(f"[Error] Failed to render image to hardware: {e}")
            print("Falling back to local mockup file output.")
            drivers.display_mock(img)
            
        # 3. Handle pause/waiting
        wait_seconds = args.delay if args.delay is not None else t['wait']
        
        if args.step_by_step:
            safe_input("\n--> Press Enter to proceed to the next test pattern...")
        else:
            print(f"  [Waiting] Observing state... waiting {wait_seconds} seconds...")
            # Simple progress bar loop
            for s in range(int(wait_seconds)):
                time.sleep(1)
                sys.stdout.write(".")
                sys.stdout.flush()
            print("\n")

    print("============================================================")
    print("               DIAGNOSTIC SEQUENCE COMPLETE                 ")
    print("============================================================")
    print("The screen has been cleared to white.")
    print("Please share the recorded video/observations to determine:")
    print("  1. At what checkerboard scale (1x1, 2x2, 4x4, 8x8, etc.) the fading stopped.")
    print("  2. If the hatch pattern (C1) held contrast better than the dithered map (C2).")
    print("============================================================")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[Exit] Diagnostic sequence terminated by user.")
        sys.exit(0)
