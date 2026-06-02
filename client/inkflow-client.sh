#!/usr/bin/env bash
# ==============================================================================
# inkflow-client.sh - Master Management and Installer Utility for InkFlow Python Client
# ==============================================================================
# Provides a clean interactive terminal menu and CLI commands to install, configure,
# manage, diagnose, and update the standalone Python client.
# ==============================================================================

# Ensure the script is run in the client directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Color formatting helpers
CYAN='\033[0;36m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper: Print sleek visual header
print_header() {
    clear
    echo -e "${CYAN}┌────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│             📟 InkFlow Python E-Ink Client             │${NC}"
    echo -e "${CYAN}│                Master Device Controller                │${NC}"
    echo -e "${CYAN}└────────────────────────────────────────────────────────┘${NC}"
}

# Helper: Require Sudo
require_sudo() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}⚠️  This action requires system privilege levels. Escalating via sudo...${NC}"
        exec sudo "$0" "$@"
        exit $?
    fi
}

# Action: Install Client (Updated setup logic)
install_client() {
    require_sudo "install"
    
    echo -e "\n${BLUE}📦 [1/4] Installing system dependencies (SPI, Git, PIL, NumPy)...${NC}"
    apt-get update
    apt-get install -y python3-pip python3-pil python3-numpy python3-spidev git
 
    # 2. Enable SPI interface in Pi config
    echo -e "\n${BLUE}🔌 [2/4] Enabling hardware SPI interface...${NC}"
    CONFIG_FILE="/boot/firmware/config.txt"
    if [ ! -f "$CONFIG_FILE" ]; then
        CONFIG_FILE="/boot/config.txt"
    fi

    if grep -q "^dtparam=spi=on" "$CONFIG_FILE"; then
        echo -e "${GREEN}✅ SPI is already enabled in $CONFIG_FILE${NC}"
    else
        echo "dtparam=spi=on" >> "$CONFIG_FILE"
        echo -e "${GREEN}✅ Enabled SPI in $CONFIG_FILE. (Reboot may be required to apply).${NC}"
    fi

    # 3. Handle high-performance Waveshare python driver installation
    echo -e "\n${BLUE}🧬 [3/4] Installing Waveshare hardware driver (sparse clone to preserve Pi RAM)...${NC}"
    WORK_DIR=$(pwd)
    TEMP_DIR="/tmp/waveshare_sparse"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR" || exit 1

    git clone --filter=blob:none --sparse https://github.com/waveshare/e-Paper.git
    cd e-Paper
    git sparse-checkout set RaspberryPi_JetsonNano/python
    cd RaspberryPi_JetsonNano/python
    pip3 install . --break-system-packages --no-cache-dir || pip3 install . --no-cache-dir

    cd "$WORK_DIR"
    rm -rf "$TEMP_DIR"
    echo -e "${GREEN}✅ Waveshare hardware driver installed successfully!${NC}"

    # 4. Provision .env configurations
    echo -e "\n${BLUE}📡 [4/4] Provisioning Environment Configurations (.env)...${NC}"
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo -e "${GREEN}Created .env from .env.example template.${NC}"
        else
            cat <<EOF > .env
# --- InkFlow Python Client Configurations ---
TRMNL_SERVER_IP=192.168.1.100
TRMNL_SERVER_PORT=5000
TRMNL_DEVICE_NAME=Living Room Pi
TRMNL_DEVICE_ID=dynamic_mac

# --- Display Options ---
# Choose from: '4in26', '7in5', '4in2', '2in9'
TRMNL_SCREEN_TYPE=4in26
TRMNL_DISPLAY_TYPE=waveshare
TRMNL_INVERT_COLORS=false
TRMNL_DEFAULT_POLL_INTERVAL=1800
EOF
            echo -e "${GREEN}Created new .env file.${NC}"
        fi
    fi

    # Prompt user to adjust server IP, name, and screen type during installer (only if running interactively)
    if [ -t 0 ]; then
        read -p "📡 Enter your main TRMNL Server IP address (e.g. 192.168.1.100) [192.168.1.100]: " SERVER_IP
        if [ -z "$SERVER_IP" ]; then
            SERVER_IP="192.168.1.100"
        fi
        sed -i "s/TRMNL_SERVER_IP=.*/TRMNL_SERVER_IP=${SERVER_IP}/" .env 2>/dev/null || sed -i "s/SERVER_HOST=.*/SERVER_HOST=${SERVER_IP}/" .env

        read -p "📝 Enter a friendly name for this device [Living Room Pi]: " DEVICE_NAME
        if [ -z "$DEVICE_NAME" ]; then
            DEVICE_NAME="Living Room Pi"
        fi
        sed -i "s/TRMNL_DEVICE_NAME=.*/TRMNL_DEVICE_NAME=${DEVICE_NAME}/" .env

        echo -e "📺 Select your E-Paper display panel size:"
        echo -e "   [1] 4.26\" (800x480) - recommended"
        echo -e "   [2] 7.5\"  (800x480)"
        echo -e "   [3] 4.2\"  (400x300)"
        echo -e "   [4] 2.9\"  (296x128)"
        read -p "👉 Selection (1-4) [1]: " SCREEN_OPT

        case "$SCREEN_OPT" in
            2) SCREEN_TYPE="7in5" ;;
            3) SCREEN_TYPE="4in2" ;;
            4) SCREEN_TYPE="2in9" ;;
            *) SCREEN_TYPE="4in26" ;;
        esac
        sed -i "s/TRMNL_SCREEN_TYPE=.*/TRMNL_SCREEN_TYPE=${SCREEN_TYPE}/" .env
        echo -e "${GREEN}✅ Client configurations saved successfully to .env.${NC}"
    fi

    # 5. Create Systemd Service
    echo -e "\n${BLUE}⚙️ Creating systemd service background daemon (inkflow-client.service)...${NC}"
    USER_NAME=$(logname 2>/dev/null || awk -F: '$3 >= 1000 && $1 != "nobody" {print $1}' /etc/passwd | head -n 1 || echo "pi")
    SERVICE_FILE="/etc/systemd/system/inkflow-client.service"

    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=InkFlow E-Ink Display Client background daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/client.py
Restart=always
RestartSec=15
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=inkflow-client

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable inkflow-client.service
    systemctl restart inkflow-client.service

    echo -e "\n${GREEN}====================================================${NC}"
    echo -e "${GREEN}    🎉 Client Installation Successfully Completed! 🎉${NC}"
    echo -e "${GREEN}====================================================${NC}"
    echo -e "  • The E-Ink client is now running in the background."
    echo -e "  • Service will auto-launch when this Pi boots."
    echo -e ""
    echo -e "  💡 Useful Commands:"
    echo -e "      • Check logs:    ./inkflow-client.sh logs"
    echo -e "      • Status check:  ./inkflow-client.sh status"
    echo -e "      • Restart:       ./inkflow-client.sh restart"
    echo -e "${GREEN}====================================================${NC}\n"
    if [ -t 0 ]; then
        read -n 1 -s -r -p "Press any key to return to menu..."
    fi
}

# Action: Start Client
start_client() {
    echo -e "\n${BLUE}🚀 Starting inkflow-client background service...${NC}"
    if sudo systemctl start inkflow-client.service; then
        echo -e "${GREEN}✅ Service started successfully!${NC}"
    else
        echo -e "${RED}❌ Failed to start service.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Stop Client
stop_client() {
    echo -e "\n${RED}🛑 Stopping inkflow-client background service...${NC}"
    if sudo systemctl stop inkflow-client.service; then
        echo -e "${GREEN}✅ Service stopped successfully.${NC}"
    else
        echo -e "${RED}❌ Failed to stop service.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Restart Client
restart_client() {
    echo -e "\n${BLUE}🔄 Restarting inkflow-client background service...${NC}"
    if sudo systemctl restart inkflow-client.service; then
        echo -e "${GREEN}✅ Service restarted successfully!${NC}"
    else
        echo -e "${RED}❌ Failed to restart service.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: View Live Logs
view_logs() {
    echo -e "\n${BLUE}📋 Opening inkflow-client live log feed (Press Ctrl+C to exit)...${NC}"
    echo -e "${BLUE}----------------------------------------------------------------------${NC}"
    sudo journalctl -u inkflow-client.service -f -n 50
}

# Action: Diagnostics Scan
run_diagnostics() {
    echo -e "\n${BLUE}🔍 Running Client Diagnostics Scan...${NC}"
    echo -e "${BLUE}------------------------------------------------------------${NC}"

    # 1. Check Service
    echo -n "• Client Service (inkflow-client.service): "
    if systemctl is-active --quiet inkflow-client.service 2>/dev/null; then
        echo -e "${GREEN}🟢 ACTIVE (Running)${NC}"
    else
        echo -e "${RED}🔴 INACTIVE (Stopped)${NC}"
    fi

    # 2. Check SPI
    echo -n "• SPI Hardware Controller: "
    if [ -c "/dev/spidev0.0" ] || [ -c "/dev/spidev0.1" ]; then
        echo -e "${GREEN}🟢 ENABLED (SPI registers responsive)${NC}"
    else
        echo -e "${RED}🔴 DISABLED (Enable SPI interface in raspi-config)${NC}"
    fi

    # 3. Read .env Config Parameters
    echo -e "\n${BLUE}⚙️  Configured Environmental Settings (.env):${NC}"
    if [ -f ".env" ]; then
        # Parse and list server details
        SERVER_IP=$(grep -E '^(TRMNL_SERVER_IP|SERVER_HOST)=' .env | cut -d= -f2 | tr -d '"'\''')
        SERVER_PORT=$(grep -E '^(TRMNL_SERVER_PORT|SERVER_PORT)=' .env | cut -d= -f2 | tr -d '"'\''')
        SCREEN_TYPE=$(grep -E '^(TRMNL_SCREEN_TYPE|SCREEN_TYPE)=' .env | cut -d= -f2 | tr -d '"'\''')
        DEVICE_NAME=$(grep -E '^(TRMNL_DEVICE_NAME|DEVICE_NAME)=' .env | cut -d= -f2 | tr -d '"'\''')

        echo -e "  ├─ Target Server IP:   ${CYAN}${SERVER_IP:-Unknown}${NC}"
        echo -e "  ├─ Target Server Port: ${CYAN}${SERVER_PORT:-5000}${NC}"
        echo -e "  ├─ E-Ink Screen Type:  ${CYAN}${SCREEN_TYPE:-4in26}${NC}"
        echo -e "  └─ Device Panel Name:  ${CYAN}${DEVICE_NAME:-Living Room Pi}${NC}"

        # Test server ping/connection
        if [ -n "$SERVER_IP" ]; then
            echo -n "• Connection to Server Host: "
            if ping -c 1 -W 2 "$SERVER_IP" &>/dev/null; then
                echo -e "${GREEN}🟢 CONNECTED (Ping responded)${NC}"
            else
                echo -e "${RED}🔴 OFFLINE (Server host unreachable)${NC}"
            fi
        fi
    else
        echo -e "  ${RED}🔴 .env configuration file missing! Run installer option [1].${NC}"
    fi

    # 4. Read Live Telemetry
    echo -e "\n${BLUE}📡 Active Telemetry Scan:${NC}"
    MAC_ADDR=$(cat /sys/class/net/wlan0/address 2>/dev/null || cat /sys/class/net/eth0/address 2>/dev/null || echo "Unknown")
    echo -e "  ├─ Client MAC (Device ID): ${CYAN}${MAC_ADDR}${NC}"
    
    if command -v iwconfig &>/dev/null; then
        RSSI_VAL=$(iwconfig wlan0 2>/dev/null | grep -o -E "Link Quality=[0-9/]+" || echo "")
        echo -e "  └─ WiFi Link Quality:      ${CYAN}${RSSI_VAL:-N/A}${NC}"
    else
        echo -e "  └─ WiFi Link Quality:      ${CYAN}iwconfig utility missing${NC}"
    fi

    echo -e "${BLUE}------------------------------------------------------------${NC}"
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Pull Codebase Updates (Client Only)
update_client() {
    echo -e "\n${BLUE}🔄 [1/2] Checking out latest codebase changes...${NC}"
    # Backup .env safely
    if [ -f ".env" ]; then
        cp .env .env.bak
    fi

    # Execute git pull
    if git pull origin main; then
        echo -e "${GREEN}✅ Codebase pulled successfully!${NC}"
    else
        echo -e "${RED}❌ Git pull failed. Verify your network or credentials.${NC}"
        if [ -f ".env.bak" ]; then mv .env.bak .env; fi
        read -n 1 -s -r -p "Press any key to return..."
        return 1
    fi

    # Restore .env
    if [ -f ".env.bak" ]; then
        mv .env.bak .env
    fi

    # Restart service
    echo -e "\n${BLUE}🔄 [2/2] Reloading background service...${NC}"
    if sudo systemctl restart inkflow-client.service 2>/dev/null; then
        echo -e "${GREEN}✅ Client daemon restarted with new updates successfully!${NC}"
    else
        echo -e "${YELLOW}⚠️ Updates pulled, but systemd service restart failed. Run: ./inkflow-client.sh restart${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Main Interactive Menu loop
show_menu() {
    while true; do
        print_header
        
        # Check current service status for header info
        if systemctl is-active --quiet inkflow-client.service 2>/dev/null; then
            STATUS_STR="${GREEN}🟢 RUNNING (persistent background)${NC}"
        else
            STATUS_STR="${RED}🔴 STOPPED${NC}"
        fi
        
        echo -e " Client Daemon:  $STATUS_STR"
        echo -e "──────────────────────────────────────────────────────────"
        echo -e " ${BLUE}[1]${NC}  📟 Run Automated Client Setup/Installer"
        echo -e " ${BLUE}[2]${NC}  🚀 Start Client Background Daemon"
        echo -e " ${BLUE}[3]${NC}  🛑 Stop Client Background Daemon"
        echo -e " ${BLUE}[4]${NC}  🔄 Restart Client Background Daemon"
        echo -e " ${BLUE}[5]${NC}  📋 View Real-Time Client Logs"
        echo -e " ${BLUE}[6]${NC}  🔍 Run Client Diagnostics Scan"
        echo -e " ${BLUE}[7]${NC}  📥 Pull Client Codebase Updates"
        echo -e " ${RED}[8]${NC}  ❌ Exit"
        echo -e "──────────────────────────────────────────────────────────"
        echo -n " Select an option [1-8]: "
        
        read -r choice
        case $choice in
            1) install_client ;;
            2) start_client ;;
            3) stop_client ;;
            4) restart_client ;;
            5) view_logs ;;
            6) run_diagnostics ;;
            7) update_client ;;
            8) exit 0 ;;
            *) echo -e "${RED}Invalid option, try again.${NC}"; sleep 1 ;;
        esac
    done
}

# Parse Command Line Arguments directly
if [ $# -gt 0 ]; then
    case "$1" in
        install)     install_client ;;
        start)       start_client ;;
        stop)        stop_client ;;
        restart)     restart_client ;;
        logs)        view_logs ;;
        status)      run_diagnostics ;;
        update)      update_client ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo -e "Usage: $0 {install|start|stop|restart|logs|status|update}"
            exit 1
            ;;
    esac
else
    # Default: Show elegant interactive menu
    show_menu
fi
