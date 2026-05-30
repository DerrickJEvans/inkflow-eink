#!/usr/bin/env bash
# ==============================================================================
# inkflow-bootstrap.sh - Automatic Firstboot Provisioner
# ==============================================================================
# Reads the FAT boot partition for user configuration directives and configures
# client/server services in real-time.
# ==============================================================================

set -x

BOOT_DIR="/boot/firmware"
[ ! -d "$BOOT_DIR" ] && BOOT_DIR="/boot"
SETUP_FILE="${BOOT_DIR}/inkflow-setup.txt"

# If no config is found on the boot partition, exit silently
if [ ! -f "$SETUP_FILE" ]; then
    echo "No inkflow-setup.txt configuration found on FAT partition. Skipping auto-provisioning."
    exit 0
fi

# Clean up Windows line endings in the config file
sed -i 's/\r$//' "$SETUP_FILE"

# Parse configuration values
ROLE=$(grep -E '^ROLE=' "$SETUP_FILE" | cut -d= -f2 | tr -d '"'\'' ')
DEVICE_NAME=$(grep -E '^DEVICE_NAME=' "$SETUP_FILE" | cut -d= -f2 | tr -d '"'\''')
SCREEN_TYPE=$(grep -E '^SCREEN_TYPE=' "$SETUP_FILE" | cut -d= -f2 | tr -d '"'\'' ')
SERVER_IP=$(grep -E '^SERVER_IP=' "$SETUP_FILE" | cut -d= -f2 | tr -d '"'\'' ')

# --- SERVER PROVISIONING ---
if [ "$ROLE" == "server" ]; then
    echo "⚙️ Configuring Server Role..."
    cd /opt/trmnl-pi-server || exit 1
    
    # Run the server installer autonomously
    chmod +x install.sh
    export DEBIAN_FRONTEND=noninteractive
    ./install.sh
    
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
    chmod +x trmnl-client.sh
    ./trmnl-client.sh install
fi

# --- CLEAN UP & PURGE BOOTSTRAPPER ---
echo "✅ Provisioning completed. Disabling firstboot service."
systemctl disable inkflow-bootstrap.service

# Move setup file to a backup so it doesn't trigger again
mv "$SETUP_FILE" "${SETUP_FILE}.processed"

exit 0
