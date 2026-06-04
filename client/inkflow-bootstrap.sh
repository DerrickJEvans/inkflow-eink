#!/usr/bin/env bash
# ==============================================================================
# inkflow-bootstrap.sh - Automatic Firstboot Provisioner
# ==============================================================================
# Reads the FAT boot partition for user configuration directives and configures
# client/server services in real-time.
# ==============================================================================

set -euxo pipefail

BOOT_DIR="/boot/firmware"
[ ! -d "$BOOT_DIR" ] && BOOT_DIR="/boot"
SETUP_FILE="${BOOT_DIR}/inkflow-setup.txt"

# Helper: Print sleek progress notifications directly to physical HDMI display / active TTY
log_console() {
    local msg="🤖 \033[1;36m[InkFlow Setup]\033[0m \033[1;33m$1\033[0m"
    echo -e "$msg"
    # Write to physical terminal interfaces so users see overlay notifications above login screens
    for tty in /dev/console /dev/tty1 /dev/tty0; do
        if [ -c "$tty" ]; then
            echo -e "\n$msg\n" > "$tty" 2>/dev/null || true
        fi
    done
}

# If no config is found on the boot partition, exit silently
if [ ! -f "$SETUP_FILE" ]; then
    log_console "No inkflow-setup.txt configuration found on FAT partition. Skipping auto-provisioning."
    exit 0
fi

# Clean up Windows line endings in the config file (ignore errors if partition is read-only)
sed -i 's/\r$//' "$SETUP_FILE" 2>/dev/null || true

# Helper function to parse configuration values safely (using a single awk process to avoid grep/pipeline set -e crashes)
parse_setup_val() {
    local key="$1"
    awk -v k="$key" '
    $0 ~ "^" k "=" {
        val = $0
        sub("^" k "=", "", val)
        sub("#.*", "", val)
        sub(/^[ \t]+/, "", val)
        sub(/[ \t]+$/, "", val)
        sub(/^["\x27]/, "", val)
        sub(/["\x27]$/, "", val)
        last = val
    }
    END { if (last != "") print last }
    ' "$SETUP_FILE" 2>/dev/null || true
}

ROLE=$(parse_setup_val "ROLE")
DEVICE_NAME=$(parse_setup_val "DEVICE_NAME")
SCREEN_TYPE=$(parse_setup_val "SCREEN_TYPE")
SERVER_IP=$(parse_setup_val "SERVER_IP")

log_console "Auto-Provisioner started! Target Role: ${ROLE^^}"

# Helper function to wait for network connection before running updates/installs
wait_for_network() {
    log_console "Checking network/internet connectivity (waiting up to 90 seconds)..."
    local timeout=90
    local elapsed=0
    # Try pinging standard DNS (8.8.8.8) or Github to verify routing & resolver are active
    while ! ping -c 1 -W 2 8.8.8.8 &>/dev/null && ! ping -c 1 -W 2 github.com &>/dev/null; do
        sleep 3
        elapsed=$((elapsed + 3))
        if [ "$elapsed" -ge "$timeout" ]; then
            log_console "⚠️ Network connection check timed out. Proceeding offline..."
            return 1
        fi
        log_console "⏳ Waiting for network connection ($elapsed/${timeout}s)..."
    done
    log_console "🟢 Network is online!"
    return 0
}

# Initialize installation status state
INSTALL_SUCCESS=false

# Wait for working internet routing before launching install sequences
if wait_for_network; then
    INSTALL_SUCCESS=true
fi

# --- SERVER PROVISIONING ---
if [ "$ROLE" == "server" ]; then
    log_console "⚙️ Configuring SERVER role... Running install.sh (this will take 2-3 minutes)..."
    cd /opt/trmnl-pi-server || exit 1
    
    # Run the server installer autonomously
    sed -i 's/\r$//' install.sh 2>/dev/null || true
    chmod +x install.sh
    export DEBIAN_FRONTEND=noninteractive
    
    if ./install.sh; then
        INSTALL_SUCCESS=true
        log_console "✅ SERVER installation successfully completed!"
        # Update device settings if configured
        if [ -n "$DEVICE_NAME" ]; then
            # Dynamically set initial screen name in server config
            sed -i "s/\"name\": \"Living Room Screen\"/\"name\": \"${DEVICE_NAME}\"/" config.json 2>/dev/null
        fi
    else
        INSTALL_SUCCESS=false
        log_console "❌ SERVER installation failed. Please check logs."
    fi

# --- CLIENT PROVISIONING ---
elif [ "$ROLE" == "client" ]; then
    log_console "⚙️ Configuring CLIENT role... Running client installer (this will take 2-3 minutes)..."
    cd /opt/trmnl-pi-server/client || exit 1
    
    # Write custom .env configuration file
    cat <<EOF > .env
TRMNL_SERVER_IP=${SERVER_IP:-192.168.1.100}
TRMNL_SERVER_PORT=5000
TRMNL_DEVICE_NAME=${DEVICE_NAME:-Living Room Pi}
TRMNL_DEVICE_ID=dynamic_mac
TRMNL_SCREEN_TYPE=${SCREEN_TYPE:-4in26}
TRMNL_DISPLAY_TYPE=waveshare
TRMNL_INVERT_COLORS=false
TRMNL_DEFAULT_POLL_INTERVAL=1800
EOF

    # Execute client-only installer autonomously
    sed -i 's/\r$//' inkflow-client.sh 2>/dev/null || true
    chmod +x inkflow-client.sh
    
    if ./inkflow-client.sh install; then
        INSTALL_SUCCESS=true
        log_console "✅ CLIENT installation successfully completed!"
    else
        INSTALL_SUCCESS=false
        log_console "❌ CLIENT installation failed. Please check logs."
    fi
fi

# --- PERMISSION CORRECTIONS ---
log_console "👥 Assigning hardware access privileges and correcting directory ownerships..."
# Resolve the target non-root user (typically 'inkflow' or 'pi')
REAL_USER=$(awk -F: '$3 >= 1000 && $1 != "nobody" {print $1}' /etc/passwd | head -n 1 || echo "pi")

if [ -n "$REAL_USER" ]; then
    usermod -aG spi,gpio,dialout "$REAL_USER" || true
    chown -R "$REAL_USER:$REAL_USER" /opt/trmnl-pi-server
fi

# --- CLEAN UP & PURGE BOOTSTRAPPER ---
if [ "$INSTALL_SUCCESS" = true ]; then
    log_console "🎉 Setup finished successfully! Disabling firstboot service..."
    systemctl disable inkflow-bootstrap.service

    # Move setup file to a backup so it doesn't trigger again (ignore errors if partition is read-only)
    mv "$SETUP_FILE" "${SETUP_FILE}.processed" 2>/dev/null || true

    log_console "🔄 Rebooting system in 5 seconds to apply kernel configuration changes..."
    sleep 5
    reboot
    exit 0
else
    log_console "❌ Installation failed. Keeping firstboot active. Retrying on next boot..."
    exit 1
fi
