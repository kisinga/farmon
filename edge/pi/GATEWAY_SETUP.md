# SX1302 Gateway Setup

## Architecture

```
┌─────────────────┐
│   SX1302 HAT    │  (Waveshare LoRaWAN HAT)
└────────┬────────┘
         │ SPI
┌────────▼────────┐
│  Concentratord  │  ← systemd service (native binary)
└────────┬────────┘
         │ ZeroMQ IPC
┌────────▼────────┐
│  MQTT Forwarder │  ← systemd service (native binary)
└────────┬────────┘
         │ MQTT (port 1883)
┌────────▼────────┐
│    Mosquitto    │  ← Docker container
└────────┬────────┘
         │ MQTT
┌────────▼────────┐
│   ChirpStack    │  ← Docker container
└─────────────────┘
```

**Why this architecture:**
- Concentratord provides native SX1302 hardware access via SPI
- MQTT Forwarder bridges Concentratord to MQTT (ChirpStack's gateway protocol)
- Both run as systemd services on the host (hardware access required)
- ChirpStack and dependencies run in Docker (easier management)

## Setup

### Prerequisites
- Raspberry Pi with SX1302 HAT connected
- SPI enabled (`sudo raspi-config` → Interface Options → SPI)
- Docker stack running (`docker-compose up -d`)

### Install Gateway Components

```bash
cd /home/raspberrypi/farm/edge/pi
sudo bash setup_gateway.sh
```

This installs and configures:
- `chirpstack-concentratord-sx1302` - Hardware abstraction
- `chirpstack-mqtt-forwarder` - MQTT bridge

### Verify

```bash
# Check services
sudo systemctl status chirpstack-concentratord
sudo systemctl status chirpstack-mqtt-forwarder

# View logs
sudo journalctl -fu chirpstack-concentratord
sudo journalctl -fu chirpstack-mqtt-forwarder
```

## ChirpStack Gateway Registration

The gateway should auto-register (if `allow_unknown_gateways = true`).

1. Open ChirpStack: `http://<pi-ip>:8080`
2. Login: `admin` / `admin`
3. Go to **Gateways** - your gateway should appear
4. Click to view stats and last-seen timestamp

If not appearing:
- Check MQTT Forwarder logs: `sudo journalctl -fu chirpstack-mqtt-forwarder`
- Verify Mosquitto is running: `docker ps | grep mosquitto`

## Configuration Files

| File | Purpose |
|------|---------|
| `/etc/chirpstack-concentratord/sx1302/concentratord.toml` | Hardware config (SPI, GPIO pins) |
| `/etc/chirpstack-mqtt-forwarder/chirpstack-mqtt-forwarder.toml` | MQTT connection |
| `chirpstack/server/chirpstack.toml` | Network server config |

## Waveshare SX1302 HAT Notes

**GPIO Pin Mapping:**
- Reset: GPIO 17 (default)
- SPI: `/dev/spidev0.0`

If your HAT uses different pins, edit:
```bash
sudo nano /etc/chirpstack-concentratord/sx1302/concentratord.toml
```

## Troubleshooting

### SPI device not found
```bash
# Enable SPI
sudo raspi-config  # Interface Options → SPI → Enable
sudo reboot
```

### Concentratord fails to start
```bash
# Check logs
sudo journalctl -u chirpstack-concentratord -n 50

# Common issues:
# - SPI not enabled
# - Wrong reset pin (check HAT documentation)
# - HAT not properly seated
```

### Gateway not appearing in ChirpStack
```bash
# Check MQTT connection
mosquitto_sub -h localhost -t 'eu868/gateway/#' -v

# Should see gateway stats every 30s
```

### Permission denied on SPI
```bash
# Add user to spi group (if not running as root)
sudo usermod -aG spi $USER
```

## Services Management

```bash
# Restart gateway services
sudo systemctl restart chirpstack-concentratord chirpstack-mqtt-forwarder

# Stop gateway
sudo systemctl stop chirpstack-mqtt-forwarder chirpstack-concentratord

# Disable auto-start
sudo systemctl disable chirpstack-concentratord chirpstack-mqtt-forwarder
```
