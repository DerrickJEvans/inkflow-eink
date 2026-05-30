#!/usr/bin/env bash
# ==============================================================================
# trmnl.sh - Master Management and Diagnostic Utility for TRMNL Pi Server
# ==============================================================================
# Provides a high-fidelity interactive terminal interface and quick CLI shortcuts
# to manage services, view logs, run diagnostics, and align local systems.
# ==============================================================================

# Ensure the script is run in the repository directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Color formatting helpers
CYAN='\033[0;36m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Helper: Print modern glassmorphic styled header
print_header() {
    clear
    echo -e "${CYAN}┌────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│             🌐 TRMNL Pi E-Ink Control Center          │${NC}"
    echo -e "${CYAN}│                Master Service Controller               │${NC}"
    echo -e "${CYAN}└────────────────────────────────────────────────────────┘${NC}"
}

# Helper: Require Sudo / Root
require_sudo() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}⚠️  This action requires system privilege levels. Escalating via sudo...${NC}"
        exec sudo "$0" "$@"
        exit $?
    fi
}

# Action: Start Server
start_server() {
    echo -e "\n${BLUE}🚀 Starting TRMNL Pi Server daemon...${NC}"
    if sudo systemctl start trmnl-pi.service; then
        echo -e "${GREEN}✅ Service started successfully!${NC}"
    else
        echo -e "${RED}❌ Failed to start service. Check system logs for details.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Stop Server
stop_server() {
    echo -e "\n${RED}🛑 Stopping TRMNL Pi Server daemon...${NC}"
    if sudo systemctl stop trmnl-pi.service; then
        echo -e "${GREEN}✅ Service stopped successfully.${NC}"
    else
        echo -e "${RED}❌ Failed to stop service.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Restart Server
restart_server() {
    echo -e "\n${BLUE}🔄 Restarting TRMNL Pi Server daemon...${NC}"
    if sudo systemctl restart trmnl-pi.service; then
        echo -e "${GREEN}✅ Service restarted successfully!${NC}"
    else
        echo -e "${RED}❌ Failed to restart service.${NC}"
    fi
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: View Live Logs
view_logs() {
    echo -e "\n${MAGENTA}📋 Opening TRMNL Pi Server live log stream (Press Ctrl+C to exit)...${NC}"
    echo -e "${MAGENTA}----------------------------------------------------------------------${NC}"
    sudo journalctl -u trmnl-pi.service -f -n 50
}

# Action: Run System Diagnostics
run_diagnostics() {
    echo -e "\n${BLUE}🔍 Running Full System Diagnostics...${NC}"
    echo -e "${BLUE}------------------------------------------------------------${NC}"

    # 1. Check if Server is running
    echo -n "• TRMNL Pi Service status: "
    if systemctl is-active --quiet trmnl-pi.service; then
        echo -e "${GREEN}🟢 ACTIVE (Running in background)${NC}"
    else
        echo -e "${RED}🔴 INACTIVE (Stopped)${NC}"
    fi

    # 2. Check Port 5000 Listener
    echo -n "• Server port listener (5000): "
    if command -v ss &> /dev/null; then
        if ss -tlnp | grep -q ":5000"; then
            echo -e "${GREEN}🟢 BOUND (Listening on port 5000)${NC}"
        else
            echo -e "${YELLOW}🟡 UNBOUND (Port 5000 not listening)${NC}"
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tlnp 2>/dev/null | grep -q ":5000"; then
            echo -e "${GREEN}🟢 BOUND (Listening on port 5000)${NC}"
        else
            echo -e "${YELLOW}🟡 UNBOUND (Port 5000 not listening)${NC}"
        fi
    else
        echo -e "${NC}Unknown (ss/netstat utilities missing)${NC}"
    fi

    # 3. Check Local IP Address
    LOCAL_IP=$(hostname -I | awk '{print $1}' || echo "localhost")
    echo -e "• Primary Local Network Address: ${CYAN}http://${LOCAL_IP}:5000${NC}"

    # 4. Check Ollama Local AI Engine
    echo -n "• Local Ollama Offline AI (Option B): "
    if systemctl is-active --quiet ollama 2>/dev/null; then
        echo -e "${GREEN}🟢 ACTIVE (Running)${NC}"
        # Check model alignment
        echo -n "  └─ Model 'llama3.2:1b' status: "
        if command -v ollama &> /dev/null; then
            if ollama list | grep -q "llama3.2:1b"; then
                echo -e "${GREEN}🟢 DOWNLOADED & READY${NC}"
            else
                echo -e "${YELLOW}🟡 MISSING (Needs pull)${NC}"
            fi
        else
            echo -e "${RED}🔴 Ollama CLI not responsive${NC}"
        fi
    else
        echo -e "${YELLOW}🟡 INACTIVE (Offline/Not Installed)${NC}"
    fi

    # 5. Check Disk Space
    DISK_AVAIL=$(df -h . | awk 'NR==2 {print $4}')
    echo -e "• Available Local Storage: ${CYAN}${DISK_AVAIL}${NC}"

    # 6. Parse config.json registered screens
    echo -e "\n${BLUE}🖥️  Registered Display Screens (config.json):${NC}"
    if [ -f "config.json" ]; then
        if command -v jq &> /dev/null; then
            jq -r '.devices[] | "  └─ ID: \(.id) | Name: \(.name) | Rotation: \(.rotationIntervals | keys | join(","))""' config.json 2>/dev/null || echo -e "  ${YELLOW}No screens registered yet.${NC}"
        else
            grep -E '"(id|name)"' config.json | sed 's/^[ \t]*//' || echo -e "  ${YELLOW}No screens registered yet.${NC}"
        fi
    else
        echo -e "  ${RED}🔴 config.json missing!${NC}"
    fi

    echo -e "${BLUE}------------------------------------------------------------${NC}"
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Action: Pull Codebase Updates
pull_updates() {
    echo -e "\n${BLUE}🔄 Launching Safe Update Assistant...${NC}"
    chmod +x ./update.sh
    ./update.sh
    read -n 1 -s -r -p "Press any key to return to menu..."
}

# Main Interactive Menu loop
show_menu() {
    while true; do
        print_header
        
        # Check current service status for header info
        if systemctl is-active --quiet trmnl-pi.service; then
            STATUS_STR="${GREEN}🟢 RUNNING (production)${NC}"
        else
            STATUS_STR="${RED}🔴 STOPPED${NC}"
        fi
        LOCAL_IP=$(hostname -I | awk '{print $1}' || echo "localhost")
        
        echo -e " Server Status:  $STATUS_STR"
        echo -e " Web Interface:  ${CYAN}http://${LOCAL_IP}:5000${NC}"
        echo -e "──────────────────────────────────────────────────────────"
        echo -e " ${BLUE}[1]${NC}  🚀 Start TRMNL Pi Server"
        echo -e " ${BLUE}[2]${NC}  🛑 Stop TRMNL Pi Server"
        echo -e " ${BLUE}[3]${NC}  🔄 Restart TRMNL Pi Server"
        echo -e " ${BLUE}[4]${NC}  📋 View Real-Time Live Logs"
        echo -e " ${BLUE}[5]${NC}  🔍 Run System Diagnostics & Network Check"
        echo -e " ${BLUE}[6]${NC}  📥 Pull Core Codebase Updates"
        echo -e " ${RED}[7]${NC}  ❌ Exit"
        echo -e "──────────────────────────────────────────────────────────"
        echo -n " Select an option [1-7]: "
        
        read -r choice
        case $choice in
            1) start_server ;;
            2) stop_server ;;
            3) restart_server ;;
            4) view_logs ;;
            5) run_diagnostics ;;
            6) pull_updates ;;
            7) exit 0 ;;
            *) echo -e "${RED}Invalid option, try again.${NC}"; sleep 1 ;;
        esac
    done
}

# Parse Command Line Arguments directly
if [ $# -gt 0 ]; then
    case "$1" in
        start)   start_server ;;
        stop)    stop_server ;;
        restart) restart_server ;;
        logs)    view_logs ;;
        status)  run_diagnostics ;;
        update)  pull_updates ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo -e "Usage: $0 {start|stop|restart|logs|status|update}"
            exit 1
            ;;
    esac
else
    # Default: Show elegant interactive menu
    show_menu
fi
