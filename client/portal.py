# portal.py - AP Hotspot and Config Portal Server for Python Client
import time
import os
import sys
import json
import urllib.parse
import subprocess
import threading
import http.server
import config
import drivers
import graphics

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

class SetupPortalHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to suppress standard HTTP logging to keep stdout clean
        pass

    def handle_status(self, parsed_url):
        global last_connection_error
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        if last_connection_error:
            response = f'{{"status": "failed", "error": "{last_connection_error}"}}'
        else:
            response = '{"status": "connecting"}'
            
        self.wfile.write(response.encode("utf-8"))

    def handle_portal_root(self, parsed_url):
        global last_connection_error
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

        mac = drivers.get_mac_address()
        error_banner = ""
        if last_connection_error:
            error_banner = f"""
            <div class="alert">
              ⚠️ <strong>Connection Failed:</strong> {last_connection_error}
            </div>
            """
        
        # Serve setup page
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

    def do_GET(self):
        self.close_connection = True
        global last_connection_error, client_connected
        parsed_url = urllib.parse.urlparse(self.path)
        
        # Trigger display refresh to Step 2 (Portal URL) on first client connection
        if not client_connected and parsed_url.path != "/status":
            client_connected = True
            print("[Setup Portal] Client connected. Redrawing screen to show Portal URL QR code...")
            graphics.draw_setup_splash(error_msg=last_connection_error, step=2)

        # Dictionary-based routing
        routes = {
            "/status": self.handle_status,
            "/": self.handle_portal_root,
            "/generate_204": self.handle_portal_root,
            "/fwlink": self.handle_portal_root
        }

        handler = routes.get(parsed_url.path)
        if handler:
            handler(parsed_url)
        else:
            # Captive Portal redirect
            self.send_response(302)
            self.send_header("Location", "http://10.42.0.1:8080/")
            self.end_headers()

    def do_POST(self):
        self.close_connection = True
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
        graphics.draw_connecting_splash(ssid, server_ip, port, step=2)
        
        updates = {
            'TRMNL_SERVER_IP': server_ip,
            'TRMNL_SERVER_PORT': port,
            'TRMNL_DEVICE_NAME': device_name
        }
        update_env_file(updates)
        
        try:
            subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
            subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
        except Exception:
            pass
            
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
                print("[Setup Portal] nmcli not found. Assuming connection success for local/mock development.")
                connected = True
            except Exception as e:
                print(f"[Setup Portal] Error connecting to WiFi network: {e}")
                
        if connected:
            global httpd
            if httpd:
                print("[Setup Portal] Stopping setup web server...")
                httpd.shutdown()
                httpd.server_close()
                
            print("[Setup Portal] Restarting client process to apply configurations...")
            time.sleep(1)
            os.execv(sys.executable, [sys.executable] + sys.argv)
        else:
            last_connection_error = f"Failed to connect to '{ssid}'. Please check credentials and try again."
            
            try:
                subprocess.run(["sudo", "nmcli", "con", "delete", "id", ssid], capture_output=True, timeout=10)
            except Exception:
                pass
                
            print("[Setup Portal] WiFi connection failed. Re-activating AP setup hotspot...")
            try:
                subprocess.run(["sudo", "nmcli", "con", "down", "Hotspot"], capture_output=True, timeout=10)
                subprocess.run(["sudo", "nmcli", "con", "delete", "Hotspot"], capture_output=True, timeout=10)
                subprocess.run(["sudo", "nmcli", "dev", "wifi", "hotspot", "ssid", "InkFlow-Setup", "password", "12345678"], capture_output=True, timeout=20)
            except Exception as e:
                print(f"[Setup Portal] Warning: Re-activating hotspot failed: {e}")
                
            graphics.draw_setup_splash(error_msg=last_connection_error)
            
    except Exception as err:
        print(f"[Setup Portal] Unexpected error in connection routine: {err}")
        last_connection_error = f"System error: {err}"
        
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
            
        graphics.draw_setup_splash(error_msg=last_connection_error)

def check_hotspot_connections():
    """Parses /proc/net/arp to see if any client is connected to the 10.42.0.X subnet"""
    try:
        if not os.path.exists("/proc/net/arp"):
            return False
        with open("/proc/net/arp", "r") as f:
            lines = f.readlines()
        for line in lines[1:]:
            parts = line.split()
            if len(parts) >= 6:
                ip = parts[0]
                mac = parts[3]
                flags = parts[2]
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
            graphics.draw_setup_splash(error_msg=last_connection_error, step=2)
            break
        time.sleep(2)

def enter_ap_setup_mode():
    """Starts AP mode and serves the captive configuration portal"""
    print("[Setup Portal] Entering configuration AP mode...")
    
    global last_connection_error, client_connected, httpd
    last_connection_error = None
    client_connected = False
    
    graphics.draw_setup_splash()
    
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
        
    server_address = ('', 8080)
    httpd = http.server.HTTPServer(server_address, SetupPortalHandler)
    print("[Setup Portal] Configuration portal is active at http://10.42.0.1:8080")
    
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
