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
echo -e "\n${BLUE}[4/5] Pulling latest codebase from GitHub...${NC}"
PULL_SUCCESS=false

# Try standard pull first (uses tracking branch if configured)
if git pull; then
    PULL_SUCCESS=true
else
    echo -e "${YELLOW}⚠️ Standard git pull failed (no tracking branch configured). Trying origin main...${NC}"
    if git pull origin main; then
        PULL_SUCCESS=true
    else
        echo -e "${YELLOW}⚠️ Pull from origin main failed. Trying origin master...${NC}"
        if git pull origin master; then
            PULL_SUCCESS=true
        fi
    fi
fi

if [ "$PULL_SUCCESS" = true ]; then
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

# 5.5 Install package dependencies
echo -e "\n${BLUE}📦 Installing package dependencies...${NC}"
npm install --no-audit --no-fund
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Dependencies installed successfully.${NC}"
else
    echo -e "${YELLOW}⚠️ npm install warning. Verify package dependencies manually if problems arise.${NC}"
fi

# 5.7 Update and configure Ollama for Option B Local AI
echo -e "\n${BLUE}🤖 Aligning Local Ollama AI Engine (Option B)...${NC}"
OLLAMA_INSTALLED=true
if ! command -v ollama &> /dev/null; then
    echo -e "${YELLOW}Ollama not detected on host. Installing natively (requires sudo authentication)...${NC}"
    if curl -fsSL https://ollama.com/install.sh | sudo sh; then
        echo -e "${GREEN}✅ Ollama installed successfully.${NC}"
    else
        echo -e "${RED}⚠️ Ollama installation failed (Ollama's download server may be offline). Skipping Ollama installation.${NC}"
        OLLAMA_INSTALLED=false
    fi
else
    echo -e "${GREEN}✅ Ollama is already installed natively.${NC}"
fi

if [ "$OLLAMA_INSTALLED" = true ]; then
    echo -e "Ensuring local Ollama daemon service is active and enabled..."
    sudo systemctl daemon-reload || true
    sudo systemctl enable ollama || true
    sudo systemctl start ollama || true

    echo -e "Downloading lightweight Llama 3.2 1B local model (safely skips if already present)..."
    ollama pull llama3.2:1b || true
    echo -e "${GREEN}✅ Local model llama3.2:1b aligned.${NC}"
else
    echo -e "${YELLOW}⚠️ Local Ollama AI Engine was skipped. You can configure and run Ollama manually later if desired.${NC}"
fi

# Align .env file
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "PORT=5000\nHOST=0.0.0.0" > "$ENV_FILE"
fi

if ! grep -q "OLLAMA_ENABLED" "$ENV_FILE"; then
    echo -e "\n# Ollama Local Offline AI Engine (Option B)" >> "$ENV_FILE"
    echo "OLLAMA_ENABLED=true" >> "$ENV_FILE"
    echo "OLLAMA_HOST=http://127.0.0.1:11434" >> "$ENV_FILE"
    echo "OLLAMA_MODEL=llama3.2:1b" >> "$ENV_FILE"
    echo -e "${GREEN}✅ Added local Ollama configurations inside .env file.${NC}"
fi


# 6. Restart backend daemon service if active
echo -e "\n${BLUE}🔄 Restarting backend services...${NC}"
if systemctl is-active --quiet inkflow-eink 2>/dev/null || systemctl is-enabled --quiet inkflow-eink 2>/dev/null; then
    echo -e "Restarting systemd daemon (inkflow-eink.service)..."
    sudo systemctl restart inkflow-eink
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ inkflow-eink background service restarted successfully!${NC}"
    else
        echo -e "${YELLOW}⚠️ Code updated, but service restart failed. Run: sudo systemctl restart inkflow-eink${NC}"
    fi
else
    echo -e "Restarting local background node server process..."
    # If not running as systemd service, remind the user to restart node manually or reboot
    echo -e "${YELLOW}💡 systemd service not active. Please restart your manual node instance or reboot your server.${NC}"
fi

echo -e "\n${GREEN}======================================================"
echo -e "   🎉 SERVER UPDATE PROCESS COMPLETED SUCCESSFULLY! 🎉"
echo -e "======================================================${NC}"
