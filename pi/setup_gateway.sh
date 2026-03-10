#!/bin/bash
#
# Install chirpstack-concentratord-sx1302 binary for SX1302 HAT (e.g. Waveshare).
# The app does not start concentratord; you must run it separately (e.g. systemd or
# manually) with a config that binds event/command to the same IPC paths the app
# uses (e.g. ipc:///tmp/concentratord_event, ipc:///tmp/concentratord_command).
#
# Usage: sudo REGION=US915 bash setup_gateway.sh
#   REGION=EU868 or REGION=US915 (default: US915). Enables and starts concentratord with that config.
#

set -e

CONCENTRATORD_VERSION="4.4.1"
REGION="${REGION:-US915}"

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

# Install concentratord configs (EU868 and US915) with correct lora_std so JoinAccept downlink works.
CONF_DIR="/etc/chirpstack-concentratord"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/concentratord" && -f "$SCRIPT_DIR/concentratord/channels_us915.toml" ]]; then
  log "Installing concentratord configs (EU868 + US915)..."
  mkdir -p "$CONF_DIR"
  install -m 644 "$SCRIPT_DIR/concentratord/concentratord.toml" "$CONF_DIR/"
  install -m 644 "$SCRIPT_DIR/concentratord/concentratord_eu868.toml" "$CONF_DIR/"
  install -m 644 "$SCRIPT_DIR/concentratord/channels_us915.toml" "$CONF_DIR/"
  install -m 644 "$SCRIPT_DIR/concentratord/channels_eu868.toml" "$CONF_DIR/"
  ok "Config installed to $CONF_DIR"
else
  log "Skipping config install (concentratord/ not found); copy pi/concentratord/*.toml to $CONF_DIR manually."
fi

# Autostart concentratord with REGION (EU868 or US915)
case "$REGION" in
  EU868) MAIN_CONF="concentratord_eu868.toml"; CHAN_CONF="channels_eu868.toml" ;;
  US915) MAIN_CONF="concentratord.toml"; CHAN_CONF="channels_us915.toml" ;;
  *)     err "REGION must be EU868 or US915 (got: $REGION)"; exit 1 ;;
esac
if [[ -f "$CONF_DIR/$MAIN_CONF" && -f "$CONF_DIR/$CHAN_CONF" ]]; then
  log "Enabling concentratord service (REGION=$REGION)..."
  cat > /etc/systemd/system/concentratord.service << EOF
[Unit]
Description=ChirpStack Concentratord (SX1302)
After=network.target

[Service]
ExecStart=/usr/local/bin/chirpstack-concentratord-sx1302 -c $CONF_DIR/$MAIN_CONF -c $CONF_DIR/$CHAN_CONF
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable concentratord
  systemctl start concentratord
  ok "concentratord started (region=$REGION)"
else
  log "Skipping systemd (config files not found); start concentratord manually with -c for your region."
fi

echo ""
echo -e "${GREEN}Done.${NC} Concentratord is running with region=$REGION. In the app set Gateway → Region to $REGION and Save."
echo -e "Config uses ${CYAN}sx1302_reset_pin=17${NC} (Waveshare HAT) to avoid EBUSY on GPIO 23 (Pi SD0 CMD). See pi/concentratord/README.md."
echo ""
