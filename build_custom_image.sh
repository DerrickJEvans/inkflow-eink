#!/usr/bin/env bash
# build_custom_image.sh - Build a custom headless Raspberry Pi OS image for TRMNL Server (FUSE Edition)

set -euo pipefail

# Output styling helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0;35m' # No Color

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}   🛠️  TRMNL Pi Headless OS Image Builder (FUSE) 🛠️${NC}"
echo -e "${CYAN}======================================================${NC}"

# 1. Ensure run as root/sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[Error] Please run this script with sudo:${NC}"
  echo -e "        sudo ./build_custom_image.sh"
  exit 1
fi

PROJECT_DIR="/home/derrickjevans1/trmnl-pi-server"
BASE_IMAGE_XZ="2024-11-19-raspios-bookworm-arm64-lite.img.xz"
BASE_IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/${BASE_IMAGE_XZ}"
OUTPUT_IMAGE="trmnl-pi-server-headless.img"
MNT_ROOT="/tmp/trmnl_mnt_root"

# 2. Install host dependencies
echo -e "${CYAN}[1/7] Checking and installing host dependencies...${NC}"
apt-get update -y
apt-get install -y xz-utils curl parted rsync fuse2fs -y

# 3. Download base Raspberry Pi OS image
if [ ! -f "$BASE_IMAGE_XZ" ]; then
  echo -e "${CYAN}[2/7] Downloading base Raspberry Pi OS Bookworm Lite (64-bit)...${NC}"
  curl -L -o "$BASE_IMAGE_XZ" "$BASE_IMAGE_URL"
  echo -e "${GREEN}[✓] Download complete!${NC}"
else
  echo -e "${GREEN}[✓] Base image archive '${BASE_IMAGE_XZ}' already exists. Skipping download.${NC}"
fi

# 4. Decompress the image
echo -e "${CYAN}[3/7] Decompressing base image to '${OUTPUT_IMAGE}'...${NC}"
# Delete existing image to ensure clean slate
rm -f "$OUTPUT_IMAGE"
xz -d -c "$BASE_IMAGE_XZ" > "$OUTPUT_IMAGE"
echo -e "${GREEN}[✓] Image decompressed successfully!${NC}"

# 5. Parse partition table
echo -e "${CYAN}[4/7] Parsing partition table to locate rootfs partition offset...${NC}"
PART2_START=$(/usr/sbin/parted "$OUTPUT_IMAGE" unit B print | awk '$1 == "2" {print $2}' | tr -d 'B')
PART2_SIZE=$(/usr/sbin/parted "$OUTPUT_IMAGE" unit B print | awk '$1 == "2" {print $4}' | tr -d 'B')

# Convert sizes to Megabytes for info
PART2_START_MB=$((PART2_START / 1024 / 1024))
PART2_SIZE_MB=$((PART2_SIZE / 1024 / 1024))

echo -e "Rootfs Partition starts at byte offset: ${YELLOW}${PART2_START}${NC} (${PART2_START_MB} MB)"

# 6. Mount filesystem in user-space using FUSE directly from the image file!
echo -e "${CYAN}[5/7] Mounting ext4 rootfs directly from '${OUTPUT_IMAGE}' via FUSE (fuse2fs)...${NC}"
mkdir -p "$MNT_ROOT"
# Unmount first if previously left mounted
umount "$MNT_ROOT" 2>/dev/null || true
fuse2fs -o offset="$PART2_START" "$OUTPUT_IMAGE" "$MNT_ROOT"
sleep 1.5

# 7. Copy project files and configure setup scripts
echo -e "${CYAN}[6/7] Injecting server source code and configuration...${NC}"
TARGET_DIR="${MNT_ROOT}/home/derrickjevans1/trmnl-pi-server"
mkdir -p "$TARGET_DIR"

# Copy files using rsync, excluding large/unnecessary artifacts
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.img' \
  --exclude='*.xz' \
  --exclude='*.ext4' \
  --exclude='build_custom_image.sh' \
  "${PROJECT_DIR}/" "$TARGET_DIR/"

# Ensure file ownership is assigned to derrickjevans1 (UID 1000, GID 1000)
chown -R 1000:1000 "$TARGET_DIR"

# Ensure scripts are executable inside image
chmod +x "$TARGET_DIR/install.sh"
chmod +x "$TARGET_DIR/setup-firstboot.sh"

echo -e "${CYAN}Injecting first-boot systemd service daemon...${NC}"
cat <<EOF > "${MNT_ROOT}/etc/systemd/system/trmnl-setup.service"
[Unit]
Description=TRMNL Pi Server First Boot Setup
After=network-online.target cloud-init.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /home/derrickjevans1/trmnl-pi-server/setup-firstboot.sh
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
EOF

# Enable the first-boot service by manually symlinking it
mkdir -p "${MNT_ROOT}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/trmnl-setup.service "${MNT_ROOT}/etc/systemd/system/multi-user.target.wants/trmnl-setup.service"

# 8. Unmount and finish
echo -e "${CYAN}[7/7] Unmounting rootfs and completing final image...${NC}"
sync
sleep 1
umount "$MNT_ROOT"
rm -rf "$MNT_ROOT"

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}   🎉 Headless Custom Image Built Successfully! 🎉${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "  • Your custom image is located at:"
echo -e "    ${CYAN}${PROJECT_DIR}/${OUTPUT_IMAGE}${NC}"
echo -e ""
echo -e "  • Next Steps to write to SD Card:"
echo -e "    1. Open ${CYAN}Raspberry Pi Imager${NC}."
echo -e "    2. Under 'OS', select ${CYAN}Use custom${NC} and pick this file."
echo -e "    3. Click ${CYAN}Next${NC} -> ${CYAN}Edit Settings${NC}."
echo -e "    4. Configure your SSID, Wi-Fi password, enable SSH, and set"
echo -e "       username to ${YELLOW}derrickjevans1${NC}."
echo -e "    5. Flash, boot the Pi 5, and allow ~3 mins for first-boot install."
echo -e "${GREEN}======================================================${NC}\n"
