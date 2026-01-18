# Edge Components

Hardware and firmware for the Farmon edge network.

```
edge/
├── pi/       # Raspberry Pi gateway stack
└── heltec/   # Sensor node firmware
```

## Components

### [pi/](pi/) — Gateway Stack

Raspberry Pi running:
- **ChirpStack** — LoRaWAN network server
- **Node-RED** — Data processing and alerts  
- **PostgreSQL** — Telemetry storage
- **Mosquitto** — MQTT broker

### [heltec/](heltec/) — Sensor Firmware

ESP32 LoRaWAN firmware for Heltec V3 boards:
- Battery-powered operation
- Water flow, temperature sensors
- OLED status display

## Setup Order

```
1. Pi infrastructure    →  edge/pi/README.md
2. SX1302 gateway HAT   →  edge/pi/GATEWAY_SETUP.md  
3. ChirpStack config    →  edge/pi/README.md#registering-devices
4. Sensor firmware      →  edge/heltec/README.md
```

## Data Flow

```
Sensor (Heltec)
    │ LoRaWAN 915MHz
    ▼
Gateway (SX1302 HAT)
    │ SPI
    ▼
Concentratord
    │ ZeroMQ
    ▼
MQTT Forwarder
    │ MQTT (us915/gateway/#)
    ▼
ChirpStack
    │ MQTT (application/#)
    ▼
Node-RED → PostgreSQL
```
