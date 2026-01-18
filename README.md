![Farmon Logo](docs/images/far-mon.png)

# Farmon

**Monitor your farm. From far. Farm on!**

LoRaWAN-based farm monitoring with long-range sensors and local data processing.

## System Overview

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

## Setup Procedure

### Phase 1: Gateway Infrastructure

Set up the Raspberry Pi with all backend services.

| Step | Action | Details |
|------|--------|---------|
| 1.1 | Flash Raspberry Pi OS | Standard Raspberry Pi OS Lite |
| 1.2 | Run Pi setup script | [edge/pi/README.md](edge/pi/README.md) |
| 1.3 | Install SX1302 HAT | [edge/pi/GATEWAY_SETUP.md](edge/pi/GATEWAY_SETUP.md) |
| 1.4 | Verify gateway online | ChirpStack UI → Gateways |

**Outcome:** Gateway receiving LoRa packets, ChirpStack running, Node-RED connected.

### Phase 2: ChirpStack Configuration

Configure the LoRaWAN network server for your devices.

| Step | Action | Where |
|------|--------|-------|
| 2.1 | Create Device Profile | ChirpStack → Device profiles |
| 2.2 | Create Application | ChirpStack → Applications |
| 2.3 | Add payload decoder | Device profile → Codec tab |

See [edge/pi/README.md#registering-devices](edge/pi/README.md) for settings.

**Outcome:** ChirpStack ready to accept device registrations.

### Phase 3: Sensor Deployment

For each Heltec sensor device:

| Step | Action | Details |
|------|--------|---------|
| 3.1 | Register device in ChirpStack | Get DevEUI from serial, add to application |
| 3.2 | Copy Application Key | ChirpStack → Device → OTAA keys |
| 3.3 | Configure firmware | [edge/heltec/README.md](edge/heltec/README.md) |
| 3.4 | Flash device | `./heltec.sh flash` |
| 3.5 | Verify join | Serial shows "joined", ChirpStack shows frames |

**Outcome:** Device sending telemetry through the full pipeline.

### Phase 4: Verification

| Check | Command/Location |
|-------|------------------|
| Gateway online | ChirpStack → Gateways → Last seen |
| Device joined | ChirpStack → Device → LoRaWAN frames |
| Data flowing | Node-RED debug panel |
| Data stored | `docker exec farm-postgres psql -U farmmon -d farmmon -c "SELECT * FROM readings"` |

## Directory Structure

```
farmon/
├── edge/
│   ├── pi/           # Gateway: ChirpStack + Node-RED stack
│   │   ├── README.md           # Setup, device registration
│   │   └── GATEWAY_SETUP.md    # SX1302 HAT hardware
│   └── heltec/       # Sensors: ESP32 LoRaWAN firmware
│       └── README.md           # Build, flash, credentials
└── docs/             # Images and assets
```

## Quick Reference

| Service | URL | Credentials |
|---------|-----|-------------|
| ChirpStack | `http://<pi>:8080` | admin / admin |
| Node-RED | `http://<pi>:1880` | - |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Gateway not in ChirpStack | `sudo journalctl -fu chirpstack-concentratord` |
| Device not joining | AppKey matches? Region matches? |
| No data in Node-RED | MQTT connected? Topic pattern? |
| No data in PostgreSQL | Check Node-RED debug for errors |

See component READMEs for detailed troubleshooting.
