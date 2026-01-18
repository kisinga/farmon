# Edge Components

Hardware and firmware for the Farmon edge network.

## Components

| Directory | Description |
|-----------|-------------|
| [pi/](pi/) | Raspberry Pi gateway (ChirpStack, Node-RED, PostgreSQL) |
| [heltec/](heltec/) | Heltec ESP32 sensor firmware |

## Setup Order

1. **Gateway infrastructure** → [pi/README.md](pi/README.md)
2. **ChirpStack configuration** → [pi/README.md#registering-devices](pi/README.md#registering-devices)
3. **Sensor firmware** → [heltec/README.md](heltec/README.md)

## Data Flow

```
Heltec Sensor
    │ LoRaWAN (915/868 MHz)
    ▼
SX1302 Gateway HAT
    │ SPI
    ▼
Concentratord → MQTT Forwarder
    │ MQTT
    ▼
ChirpStack
    │ MQTT
    ▼
Node-RED → PostgreSQL
```
