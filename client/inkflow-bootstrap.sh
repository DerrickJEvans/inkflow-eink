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

# If no config is found on the boot partition, exit silently
if [ ! -f "$SETUP_FILE" ]; then
    echo "No inkflow-setup.txt configuration found on FAT partition. Skipping auto-provisioning."
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

# Helper function to wait for network connection before running updates/installs
wait_for_network() {
    echo "🔍 Checking network connectivity..."
    local timeout=90
    local elapsed=0
    # Try pinging standard DNS (8.8.8.8) or Github to verify routing & resolver are active
    while ! ping -c 1 -W 2 8.8.8.8 &>/dev/null && ! ping -c 1 -W 2 github.com &>/dev/null; do
        sleep 3
        elapsed=$((elapsed + 3))
        if [ "$elapsed" -ge "$timeout" ]; then
            echo "⚠️ Network connection check timed out. Proceeding anyway, but dependencies might fail to install."
            return 1
        fi
        echo "⏳ Waiting for network connection ($elapsed/${timeout}s)..."
    done
    echo "🟢 Network is online!"
    return 0
}

# Wait for working internet routing before launching install sequences
wait_for_network || true


# --- SERVER PROVISIONING ---
if [ "$ROLE" == "server" ]; then
    echo "⚙️ Configuring Server Role..."
    cd /opt/trmnl-pi-server || exit 1
    
    # Run the server installer autonomously
    sed -i 's/\r$//' install.sh 2>/dev/null || true
    chmod +x install.sh
    export DEBIAN_FRONTEND=noninteractive
    ./install.sh || true
    
    # Update device settings if configured
    if [ -n "$DEVICE_NAME" ]; then
        # Dynamically set initial screen name in server config
        sed -i "s/\"name\": \"Living Room Screen\"/\"name\": \"${DEVICE_NAME}\"/" config.json 2>/dev/null
    fi

# --- CLIENT PROVISIONING ---
elif [ "$ROLE" == "client" ]; then
    echo "⚙️ Configuring Client Role..."
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
    ./inkflow-client.sh install || true
fi

# --- PERMISSION CORRECTIONS ---
# Resolve the target non-root user (typically 'inkflow' or 'pi')
REAL_USER=$(awk -F: '$3 >= 1000 && $1 != "nobody" {print $1}' /etc/passwd | head -n 1 || echo "pi")

if [ -n "$REAL_USER" ]; then
    echo "👥 Assigning hardware SPI/GPIO access groups to user: $REAL_USER..."
    usermod -aG spi,gpio,dialout "$REAL_USER" || true
    
    echo "📂 Granting file ownership of /opt/trmnl-pi-server recursively to $REAL_USER..."
    chown -R "$REAL_USER:$REAL_USER" /opt/trmnl-pi-server
fi

# --- CLEAN UP & PURGE BOOTSTRAPPER ---
echo "✅ Provisioning completed. Disabling firstboot service."
systemctl disable inkflow-bootstrap.service

# Move setup file to a backup so it doesn't trigger again (ignore errors if partition is read-only)
mv "$SETUP_FILE" "${SETUP_FILE}.processed" 2>/dev/null || true

echo "🔄 Rebooting to apply kernel configurations and activate SPI bus..."
reboot
exit 0
