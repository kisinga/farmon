# Raspberry Pi Farm Server

LoRaWAN network server and IoT platform for the farm.

## Architecture

```
Heltec Nodes → SX1302 Gateway → ChirpStack → MQTT → ThingsBoard
                   (LoRa)         (UDP)      (decode)   (dashboard/rules)
```

## Services

| Service     | Port      | Purpose                          |
| ----------- | --------- | -------------------------------- |
| ChirpStack  | 8080      | LoRaWAN Network Server           |
| ThingsBoard | 9090      | IoT Platform (dashboard, rules)  |
| Gateway Bridge | 1700/udp | Receives packets from gateway |
| Mosquitto   | 1883      | MQTT broker                      |

## Quick Start

```bash
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash
```

## Default Credentials

- **ChirpStack**: admin / admin
- **ThingsBoard**:
  - System Admin: sysadmin@thingsboard.org / sysadmin
  - Tenant Admin: tenant@thingsboard.org / tenant

## Gateway Setup

Point your SX1302 gateway packet forwarder to:
- Server: `<pi-ip>`
- Port: `1700` (UDP)

## ChirpStack → ThingsBoard Integration

1. In ChirpStack: Create application, add MQTT integration
2. In ThingsBoard: Create MQTT integration subscribing to ChirpStack topics
3. Map device EUIs between platforms

## Files

| Path | Purpose |
| ---- | ------- |
| `docker-compose.yml` | Service definitions |
| `chirpstack/` | ChirpStack config |
| `mosquitto/` | MQTT broker config |
| `postgres/` | Database init script |
