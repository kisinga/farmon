# Raspberry Pi Farm Server

LoRaWAN network server and IoT platform.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Heltec Node │────▶│ SX1302 HAT  │────▶│ ChirpStack  │────▶│  Node-RED   │
│   (LoRa)    │     │(Concentratord)    │  (Docker)   │     │ (Dashboard) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │                    │
                                               ▼                    ▼
                                        ┌─────────────┐      ┌───────────┐
                                        │ PostgreSQL  │◀─────│ Automations│
                                        └─────────────┘      └───────────┘
```

## Quick Start

```bash
# 1. Setup Pi (Docker stack)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash

# 2. Setup SX1302 gateway (after HAT is connected)
cd /home/raspberrypi/farm/edge/pi
sudo bash setup_gateway.sh
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| ChirpStack | 8080 | LoRaWAN Network Server |
| Node-RED | 1880 | Dashboard, Automations, API |
| Node-RED UI | 1880/ui | Dashboard Interface |
| Mosquitto | 1883 | MQTT Broker |

## Default Credentials

- **ChirpStack**: `admin` / `admin`
- **Node-RED**: `admin` / `farmmon`

## Data Storage

Sensor readings are stored in PostgreSQL (`farmmon` database):

```sql
-- Query recent readings
SELECT * FROM readings 
WHERE device_eui = 'your-device-eui' 
ORDER BY ts DESC LIMIT 10;

-- Query by time range
SELECT * FROM readings 
WHERE ts > NOW() - INTERVAL '24 hours';
```

## Node-RED Flows

The starter flows include:

- **MQTT Subscriber** - Receives ChirpStack device events
- **PostgreSQL Storage** - Stores readings in time-series table
- **Threshold Alerts** - Example alert logic
- **REST API** - `/api/status`, `/api/readings/:device`

Access the flow editor at `http://<pi-ip>:1880`

## Files

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Docker services |
| `chirpstack/server/` | ChirpStack config |
| `nodered/` | Node-RED settings and flows |
| `setup_gateway.sh` | SX1302 gateway setup |
| `GATEWAY_SETUP.md` | Gateway documentation |

## Useful Commands

```bash
# View logs
docker-compose logs -f nodered
docker-compose logs -f chirpstack

# Restart services
docker-compose restart nodered

# Access PostgreSQL
docker exec -it farm-postgres psql -U farmmon -d farmmon

# Check MQTT messages
docker exec -it farm-mosquitto mosquitto_sub -t '#' -v
```
