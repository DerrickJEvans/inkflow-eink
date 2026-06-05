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
echo "📦 Installing system dependencies (SPI, Git, PIL, NumPy, Requests)..."
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false install -y python3-pip python3-pil python3-numpy python3-spidev python3-requests git

# 2. Enable SPI interface in Pi config
echo "🔌 Enabling hardware SPI interface..."
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

# 4. Prompt for server address configuration
echo "----------------------------------------------------"
read -p "📡 Enter the InkFlow server address (e.g. inkflow.local or 192.168.1.100): " SERVER_HOST

if [ -z "$SERVER_HOST" ]; then
  SERVER_HOST="inkflow.local"
fi

# 5. Download client executable and manager script from the local server
if [ ! -f "client.py" ]; then
  echo "📥 Downloading client.py from local server http://${SERVER_HOST}:5000/client.py..."
  if ! curl -sSL -f -o client.py "http://${SERVER_HOST}:5000/client.py"; then
    echo "⚠️  Failed to download from local server. Trying public GitHub fallback..."
    curl -sSL -f -o client.py "https://raw.githubusercontent.com/DerrickJEvans/inkflow-eink/main/client/client.py" || {
      echo "❌ Error: Could not download client.py from local server or GitHub. (Repository might be private)."
      exit 1
    }
  fi
fi

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

# 6. Write configurations to config.py
CONFIG_PY="config.py"
if [ -f "$CONFIG_PY" ]; then
  sed -i "s/SERVER_IP = .*/SERVER_IP = '${SERVER_HOST}'/" "$CONFIG_PY"
  echo "✅ Updated config.py with server address: ${SERVER_HOST}"
else
  cat <<EOF > "$CONFIG_PY"
# config.py - Configuration settings for the Python E-Ink Client
SERVER_IP = '${SERVER_HOST}'
SERVER_PORT = '5000'
DEVICE_NAME = 'Living Room Pi'
DEVICE_ID = 'dynamic_mac'
SCREEN_TYPE = '4in26'
DISPLAY_TYPE = 'waveshare'
INVERT_COLORS = False
DEFAULT_POLL_INTERVAL = 1800
EOF
  echo "✅ Created config.py with server address: ${SERVER_HOST}"
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
ExecStart=/usr/bin/python3 $CLIENT_DIR/client.py
Restart=always
RestartSec=15
StandardOutput=syslog
StandardError=syslog
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
