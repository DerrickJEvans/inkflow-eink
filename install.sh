#!/usr/bin/env bash
# install.sh - Automated installer & Systemd Daemon setup for TRMNL Pi Server
# Designed for Raspberry Pi OS (Debian Bullseye/Bookworm) on Raspberry Pi 5

set -euo pipefail

# Output styling helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0;35m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}     ⚙️  TRMNL Pi E-Ink Server Automated Installer ⚙️${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. Ensure run as root/sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[Error] Please run this script with sudo:${NC}"
  echo -e "        sudo ./install.sh"
  exit 1
fi

# Determine host user
SUDO_USER_NAME="${SUDO_USER:-derrickjevans1}"
USER_HOME="/home/${SUDO_USER_NAME}"
PROJECT_DIR="${USER_HOME}/trmnl-pi-server"

if [ ! -d "$PROJECT_DIR" ]; then
  echo -e "${RED}[Error] Project directory not found at: ${PROJECT_DIR}${NC}"
  exit 1
fi

echo -e "${CYAN}[1/5] Updating package cache...${NC}"
apt-get update -y

# 2. Install Node.js and npm if not available
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
  echo -e "${CYAN}[2/5] Node.js or npm not detected. Installing nodejs, npm, and build-essential...${NC}"
  apt-get install -y nodejs npm build-essential
else
  echo -e "${GREEN}[✓] Node.js ($(node -v)) and npm ($(npm -v)) are already installed${NC}"
fi

# 3. Install project dependencies
echo -e "${CYAN}[3/5] Installing project Node.js dependencies...${NC}"
# Run npm install as the standard user, not root, to preserve file ownership permissions
sudo -u "$SUDO_USER_NAME" -i bash -c "cd ${PROJECT_DIR} && npm install"

# 4. Set up systemd service to run server persistently on startup
echo -e "${CYAN}[4/5] Configuring systemd background daemon service...${NC}"
SERVICE_FILE="/etc/systemd/system/trmnl-pi.service"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=TRMNL Pi E-Ink Server Background Daemon
After=network.target

[Service]
Type=simple
User=${SUDO_USER_NAME}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production PORT=5000 HOST=0.0.0.0
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Refresh systemd, enable and start service
systemctl daemon-reload
systemctl enable trmnl-pi.service
systemctl restart trmnl-pi.service

# 5. Summary and Output info
echo -e "${CYAN}[5/5] Finalizing setup...${NC}"
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}   🎉 TRMNL Pi Server Successfully Installed! 🎉${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "  • The server is running persistently in the background."
echo -e "  • It will automatically launch when the Pi boots up."
echo -e ""
echo -e "  📡 Web Control Panel:   ${CYAN}http://${LOCAL_IP}:5000${NC}"
echo -e "  💾 ESP32 Raw Endpoint:  ${CYAN}http://${LOCAL_IP}:5000/api/display/raw?device=esp32_screen&width=400&height=300${NC}"
echo -e ""
echo -e "  💡 Useful Service Commands:"
echo -e "      • Check status:     sudo systemctl status trmnl-pi"
echo -e "      • View server logs: sudo journalctl -u trmnl-pi -f"
echo -e "      • Stop server:      sudo systemctl stop trmnl-pi"
echo -e "      • Restart server:   sudo systemctl restart trmnl-pi"
echo -e "${GREEN}====================================================${NC}\n"
