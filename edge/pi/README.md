# Raspberry Pi Farm Monitoring Server

LoRaWAN network server and monitoring infrastructure for the farm.

## Architecture

```
┌─────────────┐    LoRa    ┌───────────────┐    UDP/MQTT    ┌─────────────────┐
│ Heltec      │ ─────────► │ SX1302 Gateway│ ─────────────► │ Gateway Bridge  │
│ Remote      │            │               │                └────────┬────────┘
└─────────────┘            └───────────────┘                         │
                                                                     ▼
                           ┌───────────────┐    MQTT         ┌─────────────────┐
                           │ Node-RED /    │ ◄─────────────  │ ChirpStack      │
                           │ InfluxDB      │                 │ Network Server  │
                           └───────────────┘                 └─────────────────┘
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| ChirpStack | 8080 | LoRaWAN Network Server Web UI |
| Gateway Bridge | 1700/udp | Receives packets from SX1302 gateway |
| Mosquitto | 1883, 9001 | MQTT broker |
| Node-RED | 1880 | Automation and dashboard |
| InfluxDB | 8086 | Time-series data storage |

## Quick Start

```bash
# One-line Pi setup (run on fresh Raspbian)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash
```

## Setup Flow

1. Install Raspbian on Pi
2. Run `setup_farm_pi.sh` to install Docker, Tailscale, and prepare configs
3. Deploy stack via `docker-compose up -d`
4. Configure your SX1302 gateway to point to the Pi's IP address (port 1700/UDP)
5. Access ChirpStack at `http://<pi-ip>:8080` (default: admin/admin)
6. Register gateway and devices in ChirpStack

## Gateway Configuration

Point your SX1302 gateway's packet forwarder to:
- **Server address**: Pi's IP (Tailscale or local)
- **Server port**: 1700 (UDP)

## Files

| File | Purpose |
|------|---------|
| `setup_farm_pi.sh` | Complete Pi setup automation |
| `docker-compose.yml` | Container stack definition |
| `chirpstack/` | ChirpStack configuration files |
| `mosquitto/` | Mosquitto MQTT broker config |

## Environment Variables

Create a `.env` file or export these before running:

```bash
# ChirpStack
CHIRPSTACK_POSTGRES_PASSWORD=chirpstack

# InfluxDB
INFLUX_USERNAME=admin
INFLUX_PASSWORD=please-change
INFLUX_ORG=farm
INFLUX_BUCKET=sensors
INFLUX_RETENTION=90d
INFLUX_TOKEN=change-this-token
```

## Access via Tailscale

All services are accessible over your Tailscale network:
- ChirpStack: `http://<tailscale-ip>:8080`
- Node-RED: `http://<tailscale-ip>:1880`
- InfluxDB: `http://<tailscale-ip>:8086`
