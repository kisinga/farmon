# Farm Monitor - Raspberry Pi Gateway

LoRaWAN gateway and data pipeline running on Raspberry Pi with SX1302 HAT.

## Architecture

```
[Heltec Sensors] --LoRaWAN--> [SX1302 HAT] --SPI--> [Concentratord]
                                                          |
                                                     ZeroMQ IPC
                                                          |
                                                   [MQTT Forwarder]
                                                          |
                              +---------------------------+
                              |          MQTT             |
                              v                           v
                        [ChirpStack] ------------> [Node-RED]
                              |                           |
                              v                           v
                        [PostgreSQL] <--------------------|
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| ChirpStack | 8080 | LoRaWAN Network Server UI |
| Node-RED | 1880 | Flow editor and API |
| Mosquitto | 1883 | MQTT broker |
| PostgreSQL | 5432 | Database (internal) |

## Quick Start

```bash
# 1. Initial setup (creates directories, installs Docker)
sudo bash setup_farm_pi.sh

# 2. Start the stack
docker-compose up -d

# 3. Install gateway (SX1302 HAT)
sudo bash setup_gateway.sh

# 4. Setup Node-RED
docker exec farm-nodered npm install node-red-contrib-postgresql
docker cp nodered/flows.json farm-nodered:/data/flows.json
docker restart farm-nodered
```

## Configuration

### Regions
Both US915 and EU868 are enabled. Select the appropriate region when creating device profiles in ChirpStack.

- **US915**: For Waveshare US915 HAT, uses sub-band 2 (903.9-905.3 MHz)
- **EU868**: For Waveshare EU868 HAT (867-869 MHz)

### Gateway MQTT Topics
- US915: `us915/gateway/+/event/+`
- EU868: `eu868/gateway/+/event/+`

### Device Events
ChirpStack publishes to: `application/{id}/device/{eui}/event/{type}`

## File Structure

```
edge/pi/
├── docker-compose.yml      # Service definitions
├── setup_farm_pi.sh        # Initial Pi setup
├── setup_gateway.sh        # SX1302 gateway install
├── chirpstack/
│   └── server/
│       ├── chirpstack.toml     # Main config
│       ├── region_us915_0.toml # US915 channels
│       └── region_eu868.toml   # EU868 channels
├── mosquitto/
│   └── mosquitto.conf
├── nodered/
│   └── flows.json          # Node-RED flows
└── postgres/
    └── init-db.sql         # Database initialization
```

## Credentials

| Service | User | Password |
|---------|------|----------|
| ChirpStack UI | admin | admin |
| PostgreSQL (chirpstack) | chirpstack | chirpstack |
| PostgreSQL (farmmon) | farmmon | farmmon |

## Troubleshooting

### Database not initialized
```bash
docker-compose down
sudo rm -rf /srv/farm/postgres
sudo mkdir -p /srv/farm/postgres
sudo chown 999:999 /srv/farm/postgres
docker-compose up -d
```

**Warning:** Resetting the database deletes:
- All registered gateways
- All applications and devices
- All device profiles
- All historical sensor data

After reset, you must re-register your gateway, create applications/device profiles, and re-register devices. See [GATEWAY_SETUP.md](GATEWAY_SETUP.md) for steps.

### Gateway not appearing in ChirpStack
```bash
# Check concentratord
sudo journalctl -fu chirpstack-concentratord

# Check MQTT messages
docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/#' -v -C 3
```

### Node-RED MQTT disconnected
Verify broker hostname is `mosquitto` (Docker network name), not `localhost`.
