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

# Determine active non-root standard user dynamically (UID >= 1000)
SUDO_USER_NAME="${SUDO_USER:-$(logname 2>/dev/null || awk -F: '$3 >= 1000 && $1 != "nobody" {print $1}' /etc/passwd | head -n 1 || echo "pi")}"
USER_HOME=$(getent passwd "$SUDO_USER_NAME" | cut -d: -f6)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$PROJECT_DIR" ] || [ ! -f "${PROJECT_DIR}/server.js" ]; then
  echo -e "${RED}[Error] Root server script (server.js) not found in directory: ${PROJECT_DIR}${NC}"
  exit 1
fi

# Ensure standard user recursively owns the project directory for permissions and dynamic access
echo -e "${CYAN}Setting ownership of project directory to standard user ${SUDO_USER_NAME}...${NC}"
chown -R "$SUDO_USER_NAME":"$SUDO_USER_NAME" "$PROJECT_DIR"

# Create a convenient symlink in the user's home directory if it doesn't exist
USER_LINK="${USER_HOME}/inkflow-eink"
if [ ! -e "$USER_LINK" ]; then
  echo -e "${CYAN}Creating convenience symbolic link in standard user's home directory...${NC}"
  ln -sf "$PROJECT_DIR" "$USER_LINK"
  chown -h "$SUDO_USER_NAME":"$SUDO_USER_NAME" "$USER_LINK"
fi

echo -e "${CYAN}[1/5] Updating package cache...${NC}"
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update -y

# 2. Install Node.js and npm if not available
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
  echo -e "${CYAN}[2/5] Node.js or npm not detected. Installing nodejs, npm, and build-essential...${NC}"
  apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false install -y nodejs npm build-essential
else
  echo -e "${GREEN}[✓] Node.js ($(node -v)) and npm ($(npm -v)) are already installed${NC}"
fi

# 3. Install project dependencies
echo -e "${CYAN}[3/5] Installing project Node.js dependencies...${NC}"
# Run npm install as the standard user, not root, to preserve file ownership permissions
sudo -u "$SUDO_USER_NAME" -i bash -c "cd ${PROJECT_DIR} && npm install"

# 3.5. Install and configure Ollama for Option B Local AI
echo -e "${CYAN}[3.5/5] Provisioning local Ollama AI engine (Option B)...${NC}"
OLLAMA_INSTALLED=true
if ! command -v ollama &> /dev/null; then
  echo -e "${YELLOW}Ollama not detected. Running official Ollama automated installer...${NC}"
  if curl -fsSL https://ollama.com/install.sh | sh; then
    echo -e "${GREEN}[✓] Ollama installed successfully.${NC}"
  else
    echo -e "${RED}⚠️ Ollama installation failed (Ollama's download server may be offline). Skipping Ollama installation.${NC}"
    OLLAMA_INSTALLED=false
  fi
else
  echo -e "${GREEN}[✓] Ollama is already installed.${NC}"
fi

if [ "$OLLAMA_INSTALLED" = true ]; then
  echo -e "${CYAN}Ensuring Ollama daemon service is active and enabled...${NC}"
  systemctl daemon-reload || true
  systemctl enable ollama || true
  systemctl start ollama || true

  echo -e "${CYAN}Pulling lightweight Llama 3.2 1B local model (be patient, ~1.2GB download)...${NC}"
  ollama pull llama3.2:1b || true
  echo -e "${GREEN}[✓] Local model llama3.2:1b is ready.${NC}"
else
  echo -e "${YELLOW}⚠️ Local Ollama AI Engine was skipped. You can configure and run Ollama manually later if desired.${NC}"
fi

# Configure .env file automatically
ENV_FILE="${PROJECT_DIR}/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "PORT=5000\nHOST=0.0.0.0" > "$ENV_FILE"
  chown "$SUDO_USER_NAME":"$SUDO_USER_NAME" "$ENV_FILE"
fi

if ! grep -q "OLLAMA_ENABLED" "$ENV_FILE"; then
  echo -e "\n# Ollama Local Offline AI Engine (Option B)" >> "$ENV_FILE"
  echo "OLLAMA_ENABLED=true" >> "$ENV_FILE"
  echo "OLLAMA_HOST=http://127.0.0.1:11434" >> "$ENV_FILE"
  echo "OLLAMA_MODEL=llama3.2:1b" >> "$ENV_FILE"
  echo -e "${GREEN}✅ Configured local Ollama engine parameters inside .env file.${NC}"
fi


# 4. Set up systemd service to run server persistently on startup
echo -e "${CYAN}[4/5] Configuring systemd background daemon service...${NC}"
SERVICE_FILE="/etc/systemd/system/inkflow-eink.service"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=InkFlow E-Ink Server Background Daemon
After=network.target

[Service]
Type=simple
User=root
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
systemctl enable inkflow-eink.service
systemctl restart inkflow-eink.service

# 5. Summary and Output info
echo -e "${CYAN}[5/5] Finalizing setup...${NC}"
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}   🎉 InkFlow E-Ink Server Successfully Installed! 🎉${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "  • The server is running persistently in the background."
echo -e "  • It will automatically launch when the Pi boots up."
echo -e ""
echo -e "  📡 Web Control Panel:   ${CYAN}http://${LOCAL_IP}:5000${NC}"
echo -e "  💾 ESP32 Raw Endpoint:  ${CYAN}http://${LOCAL_IP}:5000/api/display/raw?device=esp32_screen&width=400&height=300${NC}"
echo -e ""
echo -e "  💡 Useful Service Commands:"
echo -e "      • Check status:     sudo systemctl status inkflow-eink"
echo -e "      • View server logs: sudo journalctl -u inkflow-eink -f"
echo -e "      • Stop server:      sudo systemctl stop inkflow-eink"
echo -e "      • Restart server:   sudo systemctl restart inkflow-eink"
echo -e "${GREEN}====================================================${NC}\n"
