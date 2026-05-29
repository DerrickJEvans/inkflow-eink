#!/usr/bin/env bash
# setup-firstboot.sh - Runs on the Raspberry Pi during the first boot to provision the server.

set -euo pipefail

LOG_FILE="/var/log/trmnl-firstboot.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "🚀 TRMNL Pi Server Headless Setup Started"
echo "=========================================="

# Wait for active internet connection
echo "Checking internet connection..."
until ping -c 1 -W 2 8.8.8.8 &>/dev/null; do
  echo "Waiting for internet connection..."
  sleep 3
done
echo "Internet connection established!"

# Navigate to the server folder
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$PROJECT_DIR" ] || [ ! -f "${PROJECT_DIR}/install.sh" ]; then
  echo "Error: Root server directory or install.sh not found at ${PROJECT_DIR}!"
  exit 1
fi

cd "$PROJECT_DIR"

# Ensure the install script is executable
chmod +x install.sh

# Run the automated installer.
# Since we run as root in systemd, let's explicitly run it.
# It will automatically detect the custom standard non-root user.
./install.sh

# Disable and clean up the first boot service so it doesn't run again
echo "Cleaning up first-boot setup daemon..."
rm -f /etc/systemd/system/multi-user.target.wants/trmnl-setup.service
rm -f /etc/systemd/system/trmnl-setup.service

echo "=========================================="
echo "🎉 TRMNL Headless Setup Completed Successfully!"
echo "=========================================="
