#!/bin/bash
#
# SX1302 Gateway Setup — Concentratord only (no MQTT forwarder)
# Backend connects to Concentratord via ZMQ (CONCENTRATORD_EVENT_URL / CONCENTRATORD_COMMAND_URL).
#
# Usage: sudo bash setup_gateway.sh [eu868|us915]
#        Default: us915
#

set -e

CONCENTRATORD_VERSION="4.4.1"
REGION_ARG="${1:-us915}"
REGION=""
case "${REGION_ARG,,}" in
  eu868) REGION="eu868" ;;
  us915) REGION="us915" ;;
  *) echo "Usage: $0 [eu868|us915]"; exit 1 ;;
esac
REGION_UPPER=$(echo "$REGION" | tr '[:lower:]' '[:upper:]')
log "Region: $REGION_UPPER"

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

log "Checking SPI..."
if ! grep -q "^dtparam=spi=on" /boot/config.txt 2>/dev/null && \
   ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
    echo -e "${YELLOW}! SPI not enabled. raspi-config → Interface Options → SPI, then reboot.${NC}"
fi
[[ ! -e /dev/spidev0.0 ]] && { err "SPI /dev/spidev0.0 not found"; exit 1; }
ok "SPI device found"

log "Installing chirpstack-concentratord-sx1302 v${CONCENTRATORD_VERSION}..."
CONC_URL="https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/chirpstack-concentratord-sx1302_${CONCENTRATORD_VERSION}_linux_${ARCH_DL}.tar.gz"
wget -q --show-progress -O /tmp/concentratord.tar.gz "$CONC_URL" || {
    err "Download failed. Check https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/"
    exit 1
}
tar -xzf /tmp/concentratord.tar.gz -C /tmp
install -m 755 /tmp/chirpstack-concentratord-sx1302 /usr/local/bin/
rm -f /tmp/concentratord.tar.gz /tmp/chirpstack-concentratord-sx1302
ok "Concentratord installed"

log "Configuring Concentratord for $REGION_UPPER..."
mkdir -p /etc/chirpstack-concentratord

# Shared config: API, log, gateway model, region, devices, reset.
cat > /etc/chirpstack-concentratord/concentratord.toml << TOML_HEAD
[concentratord]
log_level = "INFO"
log_to_syslog = false
stats_interval = "30s"

api.event_bind = "ipc:///tmp/concentratord_event"
api.command_bind = "ipc:///tmp/concentratord_command"

[gateway]
lorawan_public = true
model = "waveshare_sx1302_lorawan_gateway_hat"
region = "$REGION_UPPER"
model_flags = []
time_fallback_enabled = true

[gateway.concentrator]
TOML_HEAD

if [ "$REGION" = "eu868" ]; then
  # EU868: 8 multi_sf channels; lora_std at 868.3 MHz (RX1 = uplink freq).
  cat >> /etc/chirpstack-concentratord/concentratord.toml << 'TOML_EU868'
multi_sf_channels = [
  868100000, 868300000, 868500000,
  867100000, 867300000, 867500000, 867700000, 867900000,
]

[gateway.concentrator.lora_std]
frequency = 868300000
bandwidth = 125000
spreading_factor = 7

[gateway.concentrator.fsk]
frequency = 0
bandwidth = 0
datarate = 0

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 868300000
rssi_offset = -215.4
tx_enable = true
tx_freq_min = 863000000
tx_freq_max = 870000000

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 868500000
rssi_offset = -215.4
tx_enable = false
TOML_EU868
else
  # US915: uplink 903.9–905.3 MHz. lora_std at 904.6 (within radios); 923 MHz would panic this HAT.
  cat >> /etc/chirpstack-concentratord/concentratord.toml << 'TOML_US915'
multi_sf_channels = [
  903900000, 904100000, 904300000, 904500000,
  904700000, 904900000, 905100000, 905300000,
]

# lora_std must lie within the two radios' bandwidth (904.3 + 905.3 MHz). Setting to 923 MHz (US915 RX1)
# causes "channels do not fit within the bandwidth of the two radios". This HAT can only TX in uplink band.
[gateway.concentrator.lora_std]
frequency = 904600000
bandwidth = 500000
spreading_factor = 8

[gateway.concentrator.fsk]
frequency = 0
bandwidth = 0
datarate = 0

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 904300000
rssi_offset = -215.4
tx_enable = true
tx_freq_min = 902000000
tx_freq_max = 928000000

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 905300000
rssi_offset = -215.4
tx_enable = false
TOML_US915
fi

cat >> /etc/chirpstack-concentratord/concentratord.toml << 'TOML_TAIL'

[gateway.com_dev]
device = "/dev/spidev0.0"

[gateway.i2c_dev]
device = "/dev/i2c-1"
temp_sensor_addr = 0x39

[gateway.sx130x_reset]
reset_chip = "/dev/gpiochip0"
reset_pin = 23
power_en_chip = "/dev/gpiochip0"
power_en_pin = 18
TOML_TAIL
ok "Concentratord configured ($REGION_UPPER)"

cat > /etc/systemd/system/chirpstack-concentratord.service << 'EOF'
[Unit]
Description=ChirpStack Concentratord SX1302
After=network.target

[Service]
ExecStart=/usr/local/bin/chirpstack-concentratord-sx1302 -c /etc/chirpstack-concentratord/concentratord.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable chirpstack-concentratord
systemctl start chirpstack-concentratord
sleep 2

if systemctl is-active --quiet chirpstack-concentratord; then
    ok "Concentratord is running"
else
    err "Concentratord failed to start"
    journalctl -u chirpstack-concentratord -n 10 --no-pager
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Gateway setup complete (Concentratord only)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Backend (PocketBase) on this host: set env and run backend:"
echo "  export CONCENTRATORD_EVENT_URL=ipc:///tmp/concentratord_event"
echo "  export CONCENTRATORD_COMMAND_URL=ipc:///tmp/concentratord_command"
echo "  export CONCENTRATORD_REGION=$REGION_UPPER   # selects region profile for RX1 (EU868 or US915)"
echo "  export CONCENTRATORD_GATEWAY_ID=...       # optional"
echo ""
echo "If backend runs in Docker on this host, use the same IPC paths and mount /tmp, or use tcp://..."
echo "  docker run ... -e CONCENTRATORD_REGION=$REGION_UPPER -e CONCENTRATORD_EVENT_URL=ipc:///tmp/concentratord_event -e CONCENTRATORD_COMMAND_URL=ipc:///tmp/concentratord_command -v /tmp:/tmp ..."
echo ""
echo "Logs: sudo journalctl -fu chirpstack-concentratord"
echo ""
