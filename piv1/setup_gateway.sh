#!/bin/bash
#
# SX1302 Gateway Setup for ChirpStack
# Installs: Concentratord + MQTT Forwarder (native integration)
#
# Usage: sudo bash setup_gateway.sh
#

set -e

# --- Configuration ---
CONCENTRATORD_VERSION="4.4.1"
MQTT_FORWARDER_VERSION="4.2.3"
REGION="us915"
INSTALL_DIR="/home/${SUDO_USER:-$USER}/farm/pi"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}→${NC} $1"; }
ok()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err() { echo -e "${RED}✗${NC} $1" >&2; }

# --- Preflight ---
[[ $EUID -ne 0 ]] && { err "Run with sudo"; exit 1; }

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    aarch64) ARCH_DL="arm64" ;;
    armv7l)  ARCH_DL="armv7hf" ;;
    armv6l)  ARCH_DL="armv6" ;;
    x86_64)  ARCH_DL="amd64" ;;
    *)       err "Unsupported architecture: $ARCH"; exit 1 ;;
esac
log "Architecture: $ARCH → $ARCH_DL"

# --- SPI Check ---
log "Checking SPI..."
if ! grep -q "^dtparam=spi=on" /boot/config.txt 2>/dev/null && \
   ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
    warn "SPI not enabled. Enable with: sudo raspi-config → Interface Options → SPI"
    warn "Then reboot and re-run this script."
fi

if [[ ! -e /dev/spidev0.0 ]]; then
    err "SPI device /dev/spidev0.0 not found"
    err "Ensure SX1302 HAT is connected and SPI is enabled"
    exit 1
fi
ok "SPI device found"

# --- Install Concentratord ---
log "Installing chirpstack-concentratord-sx1302 v${CONCENTRATORD_VERSION}..."

CONC_URL="https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/chirpstack-concentratord-sx1302_${CONCENTRATORD_VERSION}_linux_${ARCH_DL}.tar.gz"
wget -q --show-progress -O /tmp/concentratord.tar.gz "$CONC_URL" || {
    err "Download failed. Check version/arch at: https://artifacts.chirpstack.io/downloads/chirpstack-concentratord/"
    exit 1
}
tar -xzf /tmp/concentratord.tar.gz -C /tmp
install -m 755 /tmp/chirpstack-concentratord-sx1302 /usr/local/bin/
rm -f /tmp/concentratord.tar.gz /tmp/chirpstack-concentratord-sx1302
ok "Concentratord installed"

# --- Install MQTT Forwarder ---
log "Installing chirpstack-mqtt-forwarder v${MQTT_FORWARDER_VERSION}..."

MQTT_URL="https://artifacts.chirpstack.io/downloads/chirpstack-mqtt-forwarder/chirpstack-mqtt-forwarder_${MQTT_FORWARDER_VERSION}_linux_${ARCH_DL}.tar.gz"
wget -q --show-progress -O /tmp/mqtt-forwarder.tar.gz "$MQTT_URL" || {
    err "Download failed. Check version/arch at: https://artifacts.chirpstack.io/downloads/chirpstack-mqtt-forwarder/"
    exit 1
}
tar -xzf /tmp/mqtt-forwarder.tar.gz -C /tmp
install -m 755 /tmp/chirpstack-mqtt-forwarder /usr/local/bin/
rm -f /tmp/mqtt-forwarder.tar.gz /tmp/chirpstack-mqtt-forwarder
ok "MQTT Forwarder installed"

# --- Configure Concentratord ---
log "Configuring Concentratord..."
mkdir -p /etc/chirpstack-concentratord

cat > /etc/chirpstack-concentratord/concentratord.toml << 'EOF'
# Concentratord for Waveshare SX1302 LoRaWAN Gateway HAT
# Docs: https://www.chirpstack.io/docs/chirpstack-concentratord/

[concentratord]
log_level = "INFO"
log_to_syslog = false
stats_interval = "30s"

api.event_bind = "ipc:///tmp/concentratord_event"
api.command_bind = "ipc:///tmp/concentratord_command"

[gateway]
lorawan_public = true
model = "waveshare_sx1302_lorawan_gateway_hat"
region = "US915"
model_flags = []
time_fallback_enabled = true

[gateway.concentrator]
# US915 sub-band 2 (channels 8-15)
multi_sf_channels = [
  903900000,
  904100000,
  904300000,
  904500000,
  904700000,
  904900000,
  905100000,
  905300000,
]

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
EOF
ok "Concentratord configured"

# --- Configure MQTT Forwarder ---
log "Configuring MQTT Forwarder..."
mkdir -p /etc/chirpstack-mqtt-forwarder

cat > /etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml << EOF
# MQTT Forwarder for Waveshare SX1302 HAT
# Bridges Concentratord to MQTT broker

[backend]
enabled = "concentratord"

  [backend.concentratord]
  event_url = "ipc:///tmp/concentratord_event"
  command_url = "ipc:///tmp/concentratord_command"

[mqtt]
server = "tcp://127.0.0.1:1883/"
topic_prefix = "${REGION}"
json = true
qos = 0
clean_session = false
EOF
ok "MQTT Forwarder configured"

# --- Systemd Services ---
log "Creating systemd services..."

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

cat > /etc/systemd/system/chirpstack-mqtt-forwarder.service << 'EOF'
[Unit]
Description=ChirpStack MQTT Forwarder
After=network.target chirpstack-concentratord.service
Requires=chirpstack-concentratord.service

[Service]
ExecStart=/usr/local/bin/chirpstack-mqtt-forwarder -c /etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
ok "Systemd services created"

# --- Enable & Start ---
log "Enabling services..."
systemctl enable chirpstack-concentratord chirpstack-mqtt-forwarder
ok "Services enabled"

log "Starting services..."
systemctl start chirpstack-concentratord
sleep 2
systemctl start chirpstack-mqtt-forwarder
sleep 2

# --- Verify ---
echo ""
if systemctl is-active --quiet chirpstack-concentratord; then
    ok "Concentratord is running"
else
    err "Concentratord failed to start"
    journalctl -u chirpstack-concentratord -n 10 --no-pager
fi

if systemctl is-active --quiet chirpstack-mqtt-forwarder; then
    ok "MQTT Forwarder is running"
else
    err "MQTT Forwarder failed to start"
    journalctl -u chirpstack-mqtt-forwarder -n 10 --no-pager
fi

# --- Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Gateway setup complete${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Services:"
echo "  sudo systemctl status chirpstack-concentratord"
echo "  sudo systemctl status chirpstack-mqtt-forwarder"
echo ""
echo "Logs:"
echo "  sudo journalctl -fu chirpstack-concentratord"
echo "  sudo journalctl -fu chirpstack-mqtt-forwarder"
echo ""
echo "ChirpStack UI: http://$(hostname -I | awk '{print $1}'):8080"
echo ""
echo "Gateway should auto-register. If not, add manually in ChirpStack."
echo ""
