# graphics.py - Pilllow drawing methods for setup, connecting, and diagnostics overlays
import time
from PIL import Image, ImageDraw, ImageFont
import config
import drivers
import portal

def draw_setup_splash(error_msg=None, step=1):
    """Renders the setup wizard splash screen onto the display"""
    print(f"[Display] Drawing setup wizard splash screen (Step {step}/2)...")
    
    img = Image.new("L", (drivers.WIDTH, drivers.HEIGHT), 255)
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
    draw.rectangle([5, 5, drivers.WIDTH - 6, drivers.HEIGHT - 6], outline=0)
    draw.rectangle([8, 8, drivers.WIDTH - 9, drivers.HEIGHT - 9], outline=0)
    
    # Header
    draw.text((25, 30), f"InkFlow E-Ink Setup (Step {step}/2)", fill=0, font=font_large)
    draw.text((25, 60), "Configure your wireless device portal:", fill=0, font=font_medium)
    draw.line([(20, 80), (drivers.WIDTH - 20, 80)], fill=0)
    
    if step == 1:
        draw.text((25, 95), "1. Connect your phone or PC to the setup WiFi network:", fill=0, font=font_medium)
        draw.text((45, 125), "SSID: InkFlow-Setup (Password: 12345678)", fill=0, font=font_large)
        draw.text((45, 160), "(Or scan the WiFi QR code on the right to connect)", fill=0, font=font_medium)
        
        draw.text((25, 205), "2. Once connected, this screen will automatically refresh", fill=0, font=font_medium)
        draw.text((45, 230), "and display the setup portal link and QR code.", fill=0, font=font_medium)
    else:
        draw.text((25, 95), "🟢 DEVICE CONNECTED SUCCESSFULLY!", fill=0, font=font_large)
        draw.text((25, 140), "2. Open the setup portal browser page to configure device:", fill=0, font=font_medium)
        draw.text((45, 170), "Go to: http://10.42.0.1:8080", fill=0, font=font_large)
        draw.text((45, 205), "(Or scan the URL QR code on the right to open portal)", fill=0, font=font_medium)
        draw.text((25, 250), "3. Enter your WiFi network password, server address, and save.", fill=0, font=font_medium)
    
    # Connection QR Code on the right (Only for screens 800px wide or larger)
    if drivers.WIDTH >= 800:
        try:
            import qrcode
            if step == 1:
                qr_wifi = qrcode.QRCode(version=1, box_size=3, border=2)
                qr_wifi.add_data("WIFI:S:InkFlow-Setup;T:WPA;P:12345678;;")
                qr_wifi.make(fit=True)
                qr_img = qr_wifi.make_image(fill_color="black", back_color="white").convert("L")
                img.paste(qr_img, (drivers.WIDTH - 220, 95))
                draw.text((drivers.WIDTH - 200, 260), "[ Scan to Connect ]", fill=0, font=font_small)
            else:
                qr_url = qrcode.QRCode(version=1, box_size=3, border=2)
                qr_url.add_data("http://10.42.0.1:8080")
                qr_url.make(fit=True)
                qr_img = qr_url.make_image(fill_color="black", back_color="white").convert("L")
                img.paste(qr_img, (drivers.WIDTH - 220, 95))
                draw.text((drivers.WIDTH - 205, 260), "[ Scan Setup URL ]", fill=0, font=font_small)
        except Exception as e:
            print(f"[Warning] Failed to generate setup QR code: {e}")
            
    if error_msg:
        draw.rectangle([20, drivers.HEIGHT - 70, drivers.WIDTH - 20, drivers.HEIGHT - 20], fill=255, outline=0)
        draw.text((35, drivers.HEIGHT - 60), "⚠️ CONNECTION FAULT ENCOUNTERED:", fill=0, font=font_small)
        draw.text((35, drivers.HEIGHT - 42), error_msg[:90], fill=0, font=font_medium)

    # Render
    if config.DISPLAY_TYPE == 'waveshare':
        drivers.display_waveshare(img)
    elif config.DISPLAY_TYPE == 'inky':
        drivers.display_inky(img)
    else:
        drivers.display_mock(img)

def draw_connecting_splash(ssid, server_ip, port, step=0):
    """Renders connection status screens onto display"""
    print(f"[Display] Drawing connecting status splash screen (SSID: {ssid})...")
    
    img = Image.new("L", (drivers.WIDTH, drivers.HEIGHT), 255)
    draw = ImageDraw.Draw(img)
    
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except IOError:
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
        font_small = ImageFont.load_default()
        
    draw.rectangle([5, 5, drivers.WIDTH - 6, drivers.HEIGHT - 6], outline=0)
    draw.rectangle([8, 8, drivers.WIDTH - 9, drivers.HEIGHT - 9], outline=0)
    
    draw.text((25, 30), "Connecting InkFlow Device", fill=0, font=font_large)
    draw.text((25, 60), f"Attuning local network configuration to wireless profile:", fill=0, font=font_medium)
    draw.line([(20, 80), (drivers.WIDTH - 20, 80)], fill=0)
    
    y = 110
    draw.text((45, y), f"📶 Target SSID:        {ssid}", fill=0, font=font_medium); y += 35
    draw.text((45, y), f"🔌 InkFlow Server:     {server_ip}:{port}", fill=0, font=font_medium); y += 35
    
    status_msg = "Attuning WiFi link..."
    if step == 1:
        status_msg = "WiFi link established! Verifying local IP address..."
    elif step == 2:
        status_msg = "Checking server response and API handshake..."
    elif step == 3:
        status_msg = "Handshake success! Downloading dithered screens..."
        
    draw.text((45, y), f"⚙️ Current Status:      {status_msg}", fill=0, font=font_medium); y += 50
    
    # Visual Loading Bar
    bar_width = drivers.WIDTH - 120
    draw.rectangle([60, y, 60 + bar_width, y + 16], outline=0)
    filled = int(bar_width * ((step + 1) / 4.0))
    draw.rectangle([62, y + 2, 60 + filled, y + 14], fill=0)
    
    if config.DISPLAY_TYPE == 'waveshare':
        drivers.display_waveshare(img)
    elif config.DISPLAY_TYPE == 'inky':
        drivers.display_inky(img)
    else:
        drivers.display_mock(img)

def draw_diagnostics_overlay(last_sync_time):
    """Renders a comprehensive system diagnostics report on E-Ink screen"""
    print("[Display] Drawing system diagnostics overlay...")
    
    img = Image.new("L", (drivers.WIDTH, drivers.HEIGHT), 255)
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
    draw.rectangle([5, 5, drivers.WIDTH - 6, drivers.HEIGHT - 6], outline=0)
    draw.rectangle([8, 8, drivers.WIDTH - 9, drivers.HEIGHT - 9], outline=0)
    
    # Header
    draw.text((25, 30), "System Diagnostics Scan", fill=0, font=font_large)
    draw.text((25, 60), "Active status report of the local client environment:", fill=0, font=font_medium)
    draw.line([(20, 80), (drivers.WIDTH - 20, 80)], fill=0)
    
    # Gather specs
    ip = drivers.get_local_ip()
    mac = drivers.get_mac_address()
    rssi = drivers.get_wifi_rssi() or "N/A"
    temp = drivers.get_cpu_temp()
    uptime, load = drivers.get_sys_stats()
    sync_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(last_sync_time)) if last_sync_time > 0 else "Never"
    
    if drivers.WIDTH >= 600:
        draw.text((35, 105), f"🖥️ Device Name:  {drivers.DEVICE_NAME}", fill=0, font=font_medium)
        draw.text((35, 135), f"🔌 Server IP:   {config.SERVER_IP}:{config.SERVER_PORT}", fill=0, font=font_medium)
        draw.text((35, 165), f"🌐 Local IP:    {ip}", fill=0, font=font_medium)
        draw.text((35, 195), f"📡 WiFi RSSI:   {rssi} dBm", fill=0, font=font_medium)
        
        draw.text((drivers.WIDTH // 2 + 10, 105), f"🏷️ MAC Address:  {mac}", fill=0, font=font_medium)
        draw.text((drivers.WIDTH // 2 + 10, 135), f"⏳ Sys Uptime:  {uptime}", fill=0, font=font_medium)
        draw.text((drivers.WIDTH // 2 + 10, 165), f"🔥 CPU Temp:    {temp} (Load: {load})", fill=0, font=font_medium)
        draw.text((drivers.WIDTH // 2 + 10, 195), f"⏱️ Last Sync:   {sync_str}", fill=0, font=font_medium)
    else:
        draw.text((25, 95), f"🖥️ Name:  {drivers.DEVICE_NAME}", fill=0, font=font_small)
        draw.text((25, 115), f"🔌 Server: {config.SERVER_IP}:{config.SERVER_PORT}", fill=0, font=font_small)
        draw.text((25, 135), f"🌐 IP:     {ip}  | MAC: {mac}", fill=0, font=font_small)
        draw.text((25, 155), f"📡 RSSI:   {rssi} dBm | Temp: {temp}", fill=0, font=font_small)
        draw.text((25, 175), f"⏳ Uptime: {uptime} | Load: {load}", fill=0, font=font_small)
        draw.text((25, 195), f"⏱️ Sync:   {sync_str}", fill=0, font=font_small)
        
    # Footer Action info
    draw.line([(20, drivers.HEIGHT - 55), (drivers.WIDTH - 20, drivers.HEIGHT - 55)], fill=0)
    draw.text((25, drivers.HEIGHT - 45), "👉 Touch Pin 8 again to exit diagnostics and trigger a manual screen refresh.", fill=0, font=font_medium)
    draw.text((25, drivers.HEIGHT - 28), "   Diagnostics overlay will automatically exit in 15 seconds.", fill=0, font=font_medium)
    
    if config.DISPLAY_TYPE == 'waveshare':
        drivers.display_waveshare(img)
    elif config.DISPLAY_TYPE == 'inky':
        drivers.display_inky(img)
    else:
        drivers.display_mock(img)
