![Farmon Logo](docs/images/far-mon.png)

# Farmon

**Monitor your farm. From far. Farm on!**

LoRaWAN-based farm monitoring with long-range sensors and local data processing.

## Architecture

```
┌─────────────────┐      LoRaWAN       ┌─────────────────┐
│  Heltec Sensors │ ──────────────────►│  SX1302 Gateway │
└─────────────────┘                    └────────┬────────┘
                                                │
                                       ┌────────▼────────┐
                                       │  Raspberry Pi   │
                                       │  ┌───────────┐  │
                                       │  │ ChirpStack│  │ LoRaWAN Server
                                       │  │ Node-RED  │  │ Data Pipeline
                                       │  │ PostgreSQL│  │ Storage
                                       │  └───────────┘  │
                                       └────────┬────────┘
                                                │ Tailscale
                                       ┌────────▼────────┐
                                       │  Remote Access  │
                                       └─────────────────┘
```

## Setup Guide

### Step 1: Set Up the Gateway

Install the Raspberry Pi infrastructure and gateway hardware.

```bash
# On a fresh Raspberry Pi
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash

# Then install the SX1302 HAT
sudo bash ~/farm/edge/pi/setup_gateway.sh
```

→ Full details: [edge/pi/README.md](edge/pi/README.md)

**Verify:** Open ChirpStack at `http://<pi-ip>:8080` — gateway should appear under Gateways.

### Step 2: Configure ChirpStack

Create the device profile and application (one-time setup).
→ Full details: [edge/pi/README.md#registering-devices](edge/pi/README.md#registering-devices)

### Step 3: Deploy Sensors

For each Heltec device:

1. **Get DevEUI:** Flash firmware, check serial output for `DevEUI: XX:XX:...`
2. **Register in ChirpStack:** Applications → farm-sensors → Add device → paste DevEUI
3. **Get AppKey:** Device → OTAA keys → Generate → copy the hex string
4. **Configure & Flash:**
   ```bash
   cd edge/heltec
   cp secrets.example.h secrets.h
   # Edit secrets.h with your AppKey
   ./heltec.sh flash
   ```

→ Full details: [edge/heltec/README.md](edge/heltec/README.md)

**Verify:** Serial shows "joined", ChirpStack shows uplink frames, Node-RED debug shows data.

## Services

| Service | URL | Login |
|---------|-----|-------|
| ChirpStack | `http://<pi>:8080` | admin / admin |
| Node-RED | `http://<pi>:1880` | — |

## Project Structure

```
farmon/
├── edge/pi/          # Gateway stack (ChirpStack, Node-RED, PostgreSQL)
└── edge/heltec/      # Sensor firmware (Heltec ESP32 LoRaWAN)
```

## Troubleshooting

| Problem | Check |
|---------|-------|
| Gateway not appearing | `sudo journalctl -fu chirpstack-concentratord` |
| Device not joining | AppKey exact match? Region matches gateway? |
| No data in Node-RED | MQTT broker connected? (green status) |
| No data in database | Check Node-RED debug panel for errors |
