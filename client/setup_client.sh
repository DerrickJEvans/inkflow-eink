#!/bin/bash
# setup_client.sh - One-click client provisioning and systemd setup for Pi Zero 2 W
# Run on the Pi Zero client: curl -sSL http://<server-ip>:5000/setup_client.sh | sudo bash

set -e

# Ensure running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this script as root (using sudo)."
  exit 1
fi

echo "===================================================="
echo "  📟 InkFlow E-Ink Client Automated Installer  📟"
echo "===================================================="

# 1. Update package list and install system dependencies
echo "📦 Installing system dependencies (SPI, I2C, Git, PIL, NumPy, Requests)..."
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false install -y python3-pip python3-pil python3-numpy python3-spidev python3-requests python3-smbus i2c-tools git

# 2. Enable SPI and I2C interfaces in Pi config
echo "🔌 Enabling hardware SPI and I2C interfaces..."
CONFIG_FILE="/boot/firmware/config.txt"
if [ ! -f "$CONFIG_FILE" ]; then
  CONFIG_FILE="/boot/config.txt"
fi

if grep -q "^dtparam=spi=on" "$CONFIG_FILE"; then
  echo "✅ SPI is already enabled in $CONFIG_FILE"
else
  echo "dtparam=spi=on" >> "$CONFIG_FILE"
  echo "✅ Enabled SPI in $CONFIG_FILE. Note: Reboot might be required to apply."
fi

if grep -q "^dtparam=i2c_arm=on" "$CONFIG_FILE"; then
  echo "✅ I2C is already enabled in $CONFIG_FILE"
else
  echo "dtparam=i2c_arm=on" >> "$CONFIG_FILE"
  echo "✅ Enabled I2C in $CONFIG_FILE. Note: Reboot might be required to apply."
fi


# 3. Handle high-performance Waveshare python driver installation (Sparse Checkout)
echo "🧬 Installing Waveshare hardware driver (sparse clone to preserve Pi Zero RAM)..."
WORK_DIR=$(pwd)
TEMP_DIR="/tmp/waveshare_sparse"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

git clone --filter=blob:none --sparse https://github.com/waveshare/e-Paper.git
cd e-Paper
git sparse-checkout set RaspberryPi_JetsonNano/python
cd RaspberryPi_JetsonNano/python
pip3 install . --break-system-packages --no-cache-dir

cd "$WORK_DIR"
rm -rf "$TEMP_DIR"
echo "✅ Waveshare hardware driver installed successfully!"

echo "🧬 Installing MPR121 capacitive touch driver..."
pip3 install adafruit-circuitpython-mpr121 --break-system-packages --no-cache-dir || pip3 install adafruit-circuitpython-mpr121 --no-cache-dir
echo "✅ MPR121 capacitive touch driver installed successfully!"

echo "🧬 Installing qrcode driver..."
pip3 install qrcode --break-system-packages --no-cache-dir || pip3 install qrcode --no-cache-dir
echo "✅ qrcode driver installed successfully!"

# 4. Prompt for server and screen configurations
echo "----------------------------------------------------"
read -p "📡 Enter the InkFlow server address (e.g. inkflow.local or 192.168.1.100) [inkflow.local]: " SERVER_HOST
if [ -z "$SERVER_HOST" ]; then
  SERVER_HOST="inkflow.local"
fi

read -p "📝 Enter a friendly name for this device [Living Room Pi]: " DEVICE_NAME
if [ -z "$DEVICE_NAME" ]; then
  DEVICE_NAME="Living Room Pi"
fi

echo "📺 Select your E-Paper display panel size:"
echo "   [1] 4.26\" (800x480) - recommended"
echo "   [2] 7.5\"  (800x480)"
echo "   [3] 4.2\"  (400x300)"
echo "   [4] 2.9\"  (296x128)"
read -p "👉 Selection (1-4) [1]: " SCREEN_OPT

case "$SCREEN_OPT" in
  2) SCREEN_TYPE="7in5" ;;
  3) SCREEN_TYPE="4in2" ;;
  4) SCREEN_TYPE="2in9" ;;
  *) SCREEN_TYPE="4in26" ;;
esac

# 5. Download client executable, modules, and manager script from the local server
CLIENT_FILES=("client.py" "drivers.py" "portal.py" "graphics.py" "cache_manager.py")
for f in "${CLIENT_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "📥 Downloading $f from local server http://${SERVER_HOST}:5000/$f..."
    if ! curl -sSL -f -o "$f" "http://${SERVER_HOST}:5000/$f"; then
      echo "⚠️  Failed to download from local server. Trying public GitHub fallback..."
      curl -sSL -f -o "$f" "https://raw.githubusercontent.com/DerrickJEvans/inkflow-eink/main/client/$f" || {
        echo "❌ Error: Could not download $f from local server or GitHub. (Repository might be private)."
        exit 1
      }
    fi
  fi
done

if [ ! -f "inkflow-client.sh" ]; then
  echo "📥 Downloading inkflow-client.sh utility from local server http://${SERVER_HOST}:5000/inkflow-client.sh..."
  if ! curl -sSL -f -o inkflow-client.sh "http://${SERVER_HOST}:5000/inkflow-client.sh"; then
    echo "⚠️  Failed to download from local server. Trying public GitHub fallback..."
    curl -sSL -f -o inkflow-client.sh "https://raw.githubusercontent.com/DerrickJEvans/inkflow-eink/main/client/inkflow-client.sh" || {
      echo "⚠️  Could not download inkflow-client.sh."
    }
  fi
  [ -f "inkflow-client.sh" ] && chmod +x inkflow-client.sh
fi

# 6. Write configurations to .env file
ENV_FILE=".env"
cat <<EOF > "$ENV_FILE"
TRMNL_SERVER_IP=${SERVER_HOST}
TRMNL_SERVER_PORT=5000
TRMNL_DEVICE_NAME=${DEVICE_NAME}
TRMNL_DEVICE_ID=dynamic_mac
TRMNL_SCREEN_TYPE=${SCREEN_TYPE}
TRMNL_DISPLAY_TYPE=waveshare
TRMNL_INVERT_COLORS=false
TRMNL_DEFAULT_POLL_INTERVAL=1800
TRMNL_MPR121_ENABLED=false
TRMNL_MPR121_PREV_PIN=6
TRMNL_MPR121_NEXT_PIN=7
TRMNL_MPR121_SETUP_PIN=9
TRMNL_MPR121_DIAG_PIN=8
EOF
echo "✅ Created .env configurations file!"

# Ensure a config.py is present as fallback driver runner
CONFIG_PY="config.py"
if [ ! -f "$CONFIG_PY" ]; then
  cat <<EOF > "$CONFIG_PY"
# config.py - Configuration settings loader for the Python E-Ink Client
import os
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                key, val = line.split('=', 1)
                key, val = key.strip(), val.strip()
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if key not in os.environ: os.environ[key] = val
SERVER_IP = os.environ.get('TRMNL_SERVER_IP', '192.168.1.100')
SERVER_PORT = os.environ.get('TRMNL_SERVER_PORT', '5000')
DEVICE_NAME = os.environ.get('TRMNL_DEVICE_NAME', 'Living Room Pi')
DEVICE_ID = os.environ.get('TRMNL_DEVICE_ID', 'dynamic_mac')
SCREEN_TYPE = os.environ.get('TRMNL_SCREEN_TYPE', '4in26')
DISPLAY_TYPE = os.environ.get('TRMNL_DISPLAY_TYPE', 'waveshare')
INVERT_COLORS = os.environ.get('TRMNL_INVERT_COLORS', 'false').lower() == 'true'
DEFAULT_POLL_INTERVAL = int(os.environ.get('TRMNL_DEFAULT_POLL_INTERVAL', '1800'))
WIDTH = None
HEIGHT = None
WAVESHARE_MODEL = None
MPR121_ENABLED = os.environ.get('TRMNL_MPR121_ENABLED', 'false').lower() == 'true'
MPR121_PREV_PIN = int(os.environ.get('TRMNL_MPR121_PREV_PIN', '6'))
MPR121_NEXT_PIN = int(os.environ.get('TRMNL_MPR121_NEXT_PIN', '7'))
MPR121_SETUP_PIN = int(os.environ.get('TRMNL_MPR121_SETUP_PIN', '9'))
MPR121_DIAG_PIN = int(os.environ.get('TRMNL_MPR121_DIAG_PIN', '8'))
EOF
  echo "✅ Created fallback config.py loader!"
fi

# 6. Create and register the Systemd persistent background service
echo "⚙️ Creating Systemd background service daemon..."
CLIENT_DIR=$(pwd)
USER_NAME=$(logname 2>/dev/null || awk -F: '$3 >= 1000 && $1 != "nobody" {print $1}' /etc/passwd | head -n 1 || echo "pi")

# Add client user to spi and gpio groups so they can access hardware interfaces
echo "👤 Configuring hardware permissions for user $USER_NAME..."
usermod -aG spi,gpio "$USER_NAME" || echo "⚠️  Warning: Could not add $USER_NAME to spi/gpio groups."

SERVICE_FILE="/etc/systemd/system/inkflow-client.service"
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=InkFlow E-Ink Display Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$CLIENT_DIR
ExecStart=/usr/bin/python3 -u $CLIENT_DIR/client.py
Restart=always
RestartSec=15
SyslogIdentifier=inkflow-client

[Install]
WantedBy=multi-user.target
EOF

# Reload and enable the service
systemctl daemon-reload
systemctl enable inkflow-client.service
systemctl restart inkflow-client.service

# 7. Check if SPI hardware is active
echo "🔍 Verifying hardware SPI interface..."
SPI_WARNING=false
if [ ! -e "/dev/spidev0.0" ]; then
  SPI_WARNING=true
fi

echo "===================================================="
echo "  🎉 Installation Complete! 🎉"
echo "  Status: inkflow-client service registered."
if [ "$SPI_WARNING" = true ]; then
  echo ""
  echo "  ⚠️  CRITICAL WARNING: SPI hardware interface is NOT active yet (/dev/spidev0.0 not found)!"
  echo "  👉 Since this is a new operating system, you MUST REBOOT your Raspberry Pi"
  echo "     for the SPI interface configuration to take effect."
  echo "  👉 Run: sudo reboot"
  echo ""
else
  echo "  Status: inkflow-client service started successfully."
  echo "  Run 'journalctl -u inkflow-client.service -f' to see live logs."
fi
echo "===================================================="
