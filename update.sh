#!/bin/bash
# ==============================================================================
# update.sh - Robust Update script for TRMNL Pi E-Ink Server
# ==============================================================================
# Automates configuration backup, cleaning local git indexes, pulling codebase
# updates, restoring local settings, and restarting background services safely.
# ==============================================================================

# Ensure the script is run in the repository directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Color formatting helpers
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0;0m' # No Color

echo -e "${BLUE}======================================================"
echo -e "   🔄 TRMNL Pi Server: Safe Update Assistant 🔄"
echo -e "======================================================${NC}\n"

# 1. Back up active configuration safely
if [ -f "config.json" ]; then
    echo -e "${BLUE}[1/5] Backing up active config.json...${NC}"
    cp "config.json" "config.json.bak"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Backup created successfully (config.json.bak).${NC}"
    else
        echo -e "${RED}❌ Failed to create configuration backup. Aborting update for safety.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}[1/5] No config.json found yet. Skipping backup step.${NC}"
fi

# 2. Abort any stuck merge states
echo -e "\n${BLUE}[2/5] Cleaning up repository states...${NC}"
if git merge --abort 2>/dev/null; then
    echo -e "${YELLOW}⚠️ Aborted active conflicted merge state.${NC}"
else
    echo -e "✅ No active conflicts detected."
fi

# 3. Clean local tracked indexes
echo -e "\n${BLUE}[3/5] Discarding tracked local modifications...${NC}"
git reset --hard HEAD
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Local tracked files reset successfully.${NC}"
else
    echo -e "${RED}❌ Failed to reset git index. Please check git status manually.${NC}"
    exit 1
fi

# 4. Pull fresh updates from GitHub
echo -e "\n${BLUE}[4/5] Pulling latest codebase from origin/main...${NC}"
git pull
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Codebase updated successfully!${NC}"
else
    echo -e "${RED}❌ Git pull failed. Please check network connection or credentials.${NC}"
    # Attempt to restore backup if pull fails
    if [ -f "config.json.bak" ]; then
        mv "config.json.bak" "config.json"
    fi
    exit 1
fi

# 5. Restore active configuration
if [ -f "config.json.bak" ]; then
    echo -e "\n${BLUE}[5/5] Restoring config.json settings...${NC}"
    mv "config.json.bak" "config.json"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Active settings restored completely.${NC}"
    else
        echo -e "${RED}❌ Failed to restore configuration. Active backup remains in config.json.bak.${NC}"
        exit 1
    fi
else
    echo -e "\n${YELLOW}[5/5] No backup to restore. Active configuration template initialized.${NC}"
fi

# 6. Restart backend daemon service if active
echo -e "\n${BLUE}🔄 Restarting backend services...${NC}"
if systemctl is-active --quiet trmnl-pi 2>/dev/null || systemctl is-enabled --quiet trmnl-pi 2>/dev/null; then
    echo -e "Restarting systemd daemon (trmnl-pi.service)..."
    sudo systemctl restart trmnl-pi
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ trmnl-pi background service restarted successfully!${NC}"
    else
        echo -e "${YELLOW}⚠️ Code updated, but service restart failed. Run: sudo systemctl restart trmnl-pi${NC}"
    fi
else
    echo -e "Restarting local background node server process..."
    # If not running as systemd service, remind the user to restart node manually or reboot
    echo -e "${YELLOW}💡 systemd service not active. Please restart your manual node instance or reboot your server.${NC}"
fi

echo -e "\n${GREEN}======================================================"
echo -e "   🎉 SERVER UPDATE PROCESS COMPLETED SUCCESSFULLY! 🎉"
echo -e "======================================================${NC}"
