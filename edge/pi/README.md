# Raspberry Pi Setup

Farm monitoring edge server configuration and deployment files.

## Files

| File | Purpose |
|------|---------|
| `setup_farm_pi.sh` | Complete Pi setup automation |
| `wifi_hotspot.sh` | WiFi hotspot management for Heltec devices |
| `docker-compose.yml` | Container stack for Coolify deployment |
| `config.yaml` | Service configuration parameters |

## Quick Start

```bash
# One-line Pi setup (run on fresh Raspbian install)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash

```

## Network Details

- **Hotspot SSID**: `PiHotspot`
- **Hotspot Password**: `SecurePassword123`
- **MQTT Broker**: Port 1883 (accessible to hotspot devices)
- **Node-RED Dashboard**: Port 1880 (Tailscale access)
- **InfluxDB**: Port 8086 (Tailscale access)

## Dependencies

- Raspbian OS (Pi Imager recommended)
- Internet connection for initial setup
- Tailscale account for VPN access
- Coolify instance for container management
