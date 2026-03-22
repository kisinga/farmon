# FarMon

Farm monitoring and automation platform built on community-maintained open-source tools.

## Stack

| Service | Purpose | Port |
|---------|---------|------|
| Home Assistant | Automations, dashboards, mobile app | 8123 |
| ChirpStack | LoRaWAN network server | 8080 |
| Mosquitto | MQTT broker | 1883 |
| ESPHome | WiFi device firmware management | 6052 |
| PostgreSQL | ChirpStack database | 5432 |
| Redis | ChirpStack cache | 6379 |

**Not containerised** (OS-level):
- Concentratord — SX1302 gateway HAT (systemd)
- Tailscale — VPN for remote access

## Device Strategy

- **Remote monitoring**: Off-the-shelf LoRaWAN sensors (Dragino, Milesight) → ChirpStack → MQTT → HA
- **Local actuation**: ESPHome on ESP32 (WiFi) → native API → HA
- **Custom LoRaWAN nodes**: ESPHome + RAK3172/Wio-E5 (UART AT commands) → ChirpStack

## Quick Start

```bash
# Prerequisites: Raspberry Pi OS 64-bit, Docker, Docker Compose

# 1. Start the stack
docker compose up -d

# 2. Access services
#    Home Assistant: http://<pi-ip>:8123
#    ChirpStack:     http://<pi-ip>:8080 (admin/admin)
#    ESPHome:        http://<pi-ip>:6052

# 3. Configure HA MQTT integration → mosquitto:1883
# 4. Add devices in ChirpStack
# 5. Create ESPHome device configs in config/esphome/
```

## Structure

```
.
├── docker-compose.yml          # The stack
├── config/
│   ├── chirpstack/             # ChirpStack config
│   ├── chirpstack-gateway-bridge/
│   ├── mosquitto/              # MQTT broker config
│   ├── homeassistant/          # HA config (auto-populated on first run)
│   └── esphome/                # ESPHome device YAML configs
├── docs/
│   └── DEVELOPMENT_JOURNAL.md  # Project history and decision log
└── legacy/                     # Previous custom stack (reference only)
```

## History

This project was previously a custom full-stack IoT platform (~30K LOC): TinyGo firmware, Go/PocketBase backend, Angular frontend. We rebuilt on community tools. See [docs/DEVELOPMENT_JOURNAL.md](docs/DEVELOPMENT_JOURNAL.md) for the full story.
