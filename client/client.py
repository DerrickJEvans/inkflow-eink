#!/usr/bin/env python3
# client.py - Main Polling E-Ink Client Entry Point
import time
import sys
import requests
import config
import drivers
import cache_manager
import graphics
import portal

# Check for MPR121 capacitive touch module availability
mpr121 = None
mpr121_enabled = getattr(config, 'MPR121_ENABLED', False)

if mpr121_enabled:
    print("[MPR121 Startup Check] Checking for capacitive touch module...")
    try:
        import board
        import busio
        import adafruit_mpr121
        
        try:
            i2c = busio.I2C(board.SCL, board.SDA)
            mpr121 = adafruit_mpr121.MPR121(i2c)
            # Set thresholds for touch sensitivity
            for i in range(12):
                mpr121[i].threshold = 7
                mpr121[i].release_threshold = 3
            print(f"[MPR121 Startup Check] [SUCCESS] MPR121 detected and initialized. Prev: {config.MPR121_PREV_PIN}, Next: {config.MPR121_NEXT_PIN}")
        except Exception as hardware_err:
            print(f"[MPR121 Startup Check] [WARNING] MPR121 hardware not detected: {hardware_err}")
            print("[MPR121 Startup Check] Touch interface disabled. Running in polling-only mode.")
            mpr121 = None
    except ImportError as import_err:
        print(f"[MPR121 Startup Check] [WARNING] MPR121 libraries not found: {import_err}")
        print("[MPR121 Startup Check] Touch interface disabled. Running in polling-only mode.")
        mpr121 = None
else:
    print("[MPR121 Startup Check] MPR121 capacitive touch is disabled.")

def poll_server():
    """Main client fetch loop"""
    device_id = getattr(config, 'DEVICE_ID', 'dynamic_mac')
    if device_id == 'dynamic_mac' or not device_id:
        print("[WiFi] Resolving dynamic hardware MAC address for device registration...")
        device_id = drivers.get_mac_address()

    color_depth = getattr(config, 'COLOR_DEPTH', 2)
    endpoint = "image.png" if color_depth == 4 else "raw"
    server_url = f"http://{config.SERVER_IP}:{config.SERVER_PORT}/api/display/{endpoint}"
    params = {
        'device': device_id,
        'width': drivers.WIDTH,
        'height': drivers.HEIGHT
    }
    
    print(f"\n==========================================")
    print(f"[Network] E-Ink Client Polling Started (Refactored)")
    print(f"   Server Target: {server_url}")
    print(f"   Device Name:   {drivers.DEVICE_NAME} ({device_id})")
    print(f"   Resolution:    {drivers.WIDTH}x{drivers.HEIGHT}px")
    print(f"   Driver Type:   {config.DISPLAY_TYPE.upper()}")
    print(f"==========================================\n")
    
    last_poll_time = 0
    poll_interval = getattr(config, 'DEFAULT_POLL_INTERVAL', 1800)
    force_refresh = True
    next_action = None
    last_successful_sync_time = 0
    consecutive_failures = 0
    offline_index = -1
    refresh_counter = 0
    
    diagnostics_active = False
    diagnostics_start_time = 0

    # Track touch pin transitions
    prev_touched = False
    next_touched = False
    setup_touched = False
    diag_touched = False

    while True:
        time.sleep(0.1)
        current_time = time.time()
        
        # Check if diagnostics overlay timed out
        if diagnostics_active and (current_time - diagnostics_start_time >= 15.0):
            print(f"[{time.strftime('%H:%M:%S')}] Diagnostics overlay timed out. Refreshing...")
            diagnostics_active = False
            force_refresh = True
        
        # Check MPR121 touch inputs
        if mpr121 is not None:
            try:
                prev_pin = getattr(config, 'MPR121_PREV_PIN', 6)
                next_pin = getattr(config, 'MPR121_NEXT_PIN', 7)
                setup_pin = getattr(config, 'MPR121_SETUP_PIN', 9)
                diag_pin = getattr(config, 'MPR121_DIAG_PIN', 8)
                
                curr_prev = mpr121[prev_pin].value
                curr_next = mpr121[next_pin].value
                curr_setup = mpr121[setup_pin].value
                curr_diag = mpr121[diag_pin].value
                
                if curr_prev and not prev_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] [Touch] Previous Screen Button touched!")
                    force_refresh = True
                    next_action = 'prev'
                elif curr_next and not next_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] [Touch] Next Screen Button touched!")
                    force_refresh = True
                    next_action = 'next'
                elif curr_setup and not setup_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] [Touch] Setup/AP Mode Button touched! Launching portal...")
                    portal.enter_ap_setup_mode()
                elif curr_diag and not diag_touched:
                    print(f"[{time.strftime('%H:%M:%S')}] [Touch] Diagnostics Button touched!")
                    if not diagnostics_active:
                        diagnostics_active = True
                        diagnostics_start_time = time.time()
                        graphics.draw_diagnostics_overlay(last_successful_sync_time)
                    else:
                        diagnostics_active = False
                        force_refresh = True
                        print(f"[{time.strftime('%H:%M:%S')}] Exiting diagnostics...")
                
                prev_touched = curr_prev
                next_touched = curr_next
                setup_touched = curr_setup
                diag_touched = curr_diag
            except Exception as e:
                print(f"[Warning] Error reading MPR121 pins: {e}")
                
        # Poll Server
        if not diagnostics_active and (force_refresh or (current_time - last_poll_time >= poll_interval)):
            action_to_send = next_action
            force_refresh = False
            next_action = None
            
            try:
                print(f"[{time.strftime('%H:%M:%S')}] Connecting to server to fetch fresh image...")
                
                headers = {
                    'ID': device_id,
                    'Access-Token': device_id,
                    'Device-Name': drivers.DEVICE_NAME,
                    'FW-Version': 'InkFlow-Python-v1.2.0',
                    'Battery-Voltage': 'USB'
                }
                rssi = drivers.get_wifi_rssi()
                if rssi:
                    headers['RSSI'] = rssi

                request_params = params.copy()
                if action_to_send:
                    request_params['action'] = action_to_send
                    request_params['force'] = 'true'

                response = requests.get(server_url, params=request_params, headers=headers, stream=True, timeout=10)
                
                if response.status_code != 200:
                    print(f"[Server Warning] Server responded with status code: {response.status_code}")
                    response.close()
                    raise requests.exceptions.RequestException(f"Bad status code {response.status_code}")
                
                consecutive_failures = 0
                carousel_sig = response.headers.get('X-Carousel-Signature')
                image_index_val = response.headers.get('X-Image-Index')
                total_images_val = response.headers.get('X-Total-Images')
                refresh_rate_val = response.headers.get('X-Refresh-Rate')
                
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
                    manifest = cache_manager.read_cache_manifest()
                    if manifest.get('carousel_signature') != carousel_sig:
                        print(f"[{time.strftime('%H:%M:%S')}] [Cache] Carousel signature mismatch. Purging cache...")
                        cache_manager.clear_cache_slides()
                        manifest = {
                            'carousel_signature': carousel_sig,
                            'total_images': total_images or 1,
                            'width': drivers.WIDTH,
                            'height': drivers.HEIGHT
                        }
                        cache_manager.write_cache_manifest(manifest)
                        
                    raw_bytes = cache_manager.get_cached_slide(image_index)
                    if raw_bytes is not None:
                        is_cached = True
                        print(f"[{time.strftime('%H:%M:%S')}] [Cache] Cache hit! Loading Slide {image_index} from local cache...")
                        response.close()
                
                if not is_cached:
                    try:
                        raw_bytes = response.content
                    finally:
                        response.close()
                    
                    print(f"[{time.strftime('%H:%M:%S')}] Image downloaded successfully ({len(raw_bytes)} bytes)")
                    
                    # Pad/truncate safety check
                    expected_size = int((drivers.WIDTH * drivers.HEIGHT) / 8)
                    if len(raw_bytes) < expected_size:
                        missing = expected_size - len(raw_bytes)
                        raw_bytes += b'\xff' * missing
                    elif len(raw_bytes) > expected_size:
                        raw_bytes = raw_bytes[:expected_size]
                    
                    if carousel_sig and image_index is not None:
                        cache_manager.save_cached_slide(image_index, raw_bytes)
                        print(f"[{time.strftime('%H:%M:%S')}] [Cache] Saved Slide {image_index} to local disk cache.")
                
                last_successful_sync_time = time.time()
                
                # Determine refresh mode
                full_refresh_interval = getattr(config, 'FULL_REFRESH_INTERVAL', 10)
                if refresh_counter == 0 or (full_refresh_interval > 0 and refresh_counter % full_refresh_interval == 0):
                    partial_mode = False
                    print(f"[{time.strftime('%H:%M:%S')}] Triggering FULL screen refresh (to clear ghosting)...")
                else:
                    partial_mode = True
                    print(f"[{time.strftime('%H:%M:%S')}] Triggering PARTIAL screen refresh (fast / no flashing)...")
                
                refresh_counter += 1
                
                if config.DISPLAY_TYPE == 'waveshare':
                    drivers.display_waveshare(raw_bytes, partial=partial_mode)
                elif config.DISPLAY_TYPE == 'inky':
                    drivers.display_inky(raw_bytes)
                else:
                    drivers.display_mock(raw_bytes)
                
                last_poll_time = time.time()
                poll_interval = max(1, poll_interval)
                print(f"[Status] Waiting {poll_interval} seconds...\n")
                
            except (requests.exceptions.RequestException, Exception) as e:
                consecutive_failures += 1
                is_req_err = isinstance(e, requests.exceptions.RequestException)
                err_label = "Connection Error" if is_req_err else "Unexpected Error"
                print(f"[{time.strftime('%H:%M:%S')}] [Warning] [{err_label}] {e}")
                
                # Rotating offline carousel fallback
                manifest = cache_manager.read_cache_manifest()
                total_cached = manifest.get('total_images', 0)
                carousel_sig = manifest.get('carousel_signature')
                
                if total_cached > 0 and carousel_sig:
                    offline_index = (offline_index + 1) % total_cached
                    raw_bytes = cache_manager.get_cached_slide(offline_index)
                    if raw_bytes is not None:
                        print(f"[{time.strftime('%H:%M:%S')}] [Offline] Rotating to cached Slide {offline_index}...")
                        
                        # Determine refresh mode for offline rotation
                        full_refresh_interval = getattr(config, 'FULL_REFRESH_INTERVAL', 10)
                        if refresh_counter == 0 or (full_refresh_interval > 0 and refresh_counter % full_refresh_interval == 0):
                            partial_mode = False
                            print(f"[{time.strftime('%H:%M:%S')}] [Offline] Triggering FULL screen refresh (to clear ghosting)...")
                        else:
                            partial_mode = True
                            print(f"[{time.strftime('%H:%M:%S')}] [Offline] Triggering PARTIAL screen refresh (fast / no flashing)...")
                        
                        refresh_counter += 1
                        
                        if config.DISPLAY_TYPE == 'waveshare':
                            drivers.display_waveshare(raw_bytes, partial=partial_mode)
                        elif config.DISPLAY_TYPE == 'inky':
                            drivers.display_inky(raw_bytes)
                        else:
                            drivers.display_mock(raw_bytes)
                
                if consecutive_failures >= 3:
                    print(f"[{time.strftime('%H:%M:%S')}] [Warning] {consecutive_failures} failures. Drawing diagnostics overlay...")
                    graphics.draw_diagnostics_overlay(last_successful_sync_time)
                    last_poll_time = time.time()
                    poll_interval = 30
                else:
                    print(f"Retrying in 10 seconds (failures: {consecutive_failures})...")
                    last_poll_time = time.time() - poll_interval + 10

if __name__ == "__main__":
    try:
        poll_server()
    except KeyboardInterrupt:
        print("\n[Exit] Client polling terminated. Exiting.")
        sys.exit(0)
