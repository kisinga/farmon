#!/bin/bash
#
# Install chirpstack-concentratord-sx1302 binary for SX1302 HAT (e.g. Waveshare).
# Config and process are managed from the app: Gateway settings in the UI, enable
# "Manage concentratord process" and Save. This script only installs the binary.
#
# Usage: sudo bash setup_gateway.sh
#

set -e

CONCENTRATORD_VERSION="4.4.1"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}→${NC} $1"; }
ok()  { echo -e "${GREEN}✓${NC} $1"; }
err() { echo -e "${RED}✗${NC} $1" >&2; }

[[ $EUID -ne 0 ]] && { err "Run with sudo"; exit 1; }

ARCH=$(uname -m)
case $ARCH in
    aarch64) ARCH_DL="arm64" ;;
    armv7l)  ARCH_DL="armv7hf" ;;
    armv6l)  ARCH_DL="armv6" ;;
    x86_64)  ARCH_DL="amd64" ;;
    *)       err "Unsupported architecture: $ARCH"; exit 1 ;;
esac
log "Architecture: $ARCH → $ARCH_DL"

if [[ -e /dev/spidev0.0 ]]; then
    ok "SPI device found"
else
    if ! grep -q "^dtparam=spi=on" /boot/config.txt 2>/dev/null && \
       ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
        echo -e "${YELLOW}! SPI not enabled. raspi-config → Interface Options → SPI, then reboot.${NC}"
    fi
    err "SPI device /dev/spidev0.0 not found"
    exit 1
fi

log "Installing chirpstack-concentratord-sx1302 v${CONCENTRATORD_VERSION}..."
CONC_URL="https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/chirpstack-concentratord-sx1302_${CONCENTRATORD_VERSION}_linux_${ARCH_DL}.tar.gz"
wget -q --show-progress -O /tmp/concentratord.tar.gz "$CONC_URL" || {
    err "Download failed. Check https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/"
    exit 1
}
tar -xzf /tmp/concentratord.tar.gz -C /tmp
install -m 755 /tmp/chirpstack-concentratord-sx1302 /usr/local/bin/
rm -f /tmp/concentratord.tar.gz /tmp/chirpstack-concentratord-sx1302
ok "Concentratord installed to /usr/local/bin/chirpstack-concentratord-sx1302"

echo ""
echo -e "${GREEN}Done.${NC} Open the app → Gateway settings → enable \"Manage concentratord process\" and Save. The backend will write config and start concentratord."
echo ""
