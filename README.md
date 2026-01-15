![far-mon Logo](docs/images/far-mon.png)

# farmon

**Monitor your farm. From far. Farm on!**

A modular farm-monitoring platform using LoRaWAN for sensor connectivity and ThingsBoard for data visualization and automation.

## Architecture

```
┌─────────────────┐      LoRaWAN       ┌─────────────────┐
│  Heltec Nodes   │ ─────────────────► │  SX1302 Gateway │
│  (Field Sensors)│                    │                 │
└─────────────────┘                    └────────┬────────┘
                                                │ UDP
                                                ▼
                                       ┌─────────────────┐
                                       │   Raspberry Pi  │
                                       │  ─────────────  │
                                       │  ChirpStack     │◄── LoRaWAN Network Server
                                       │  ThingsBoard    │◄── Dashboards, Rules, Alarms
                                       └────────┬────────┘
                                                │ Tailscale VPN
                                                ▼
                                       ┌─────────────────┐
                                       │ Remote Access   │
                                       └─────────────────┘
```

## Stack

| Component | Role |
| --------- | ---- |
| **Heltec Nodes** | LoRaWAN Class A sensors (soil, water, environment) |
| **SX1302 Gateway** | Receives LoRa packets, forwards to Pi |
| **ChirpStack** | LoRaWAN network server, device management |
| **ThingsBoard** | Dashboards, rule engine, alarms, data storage |
| **Tailscale** | Secure remote access |

## Capabilities

| Domain | Measurements |
| ------ | ------------ |
| Water | Tank level, flow, rain |
| Soil | Moisture |
| Livestock | Weight |
| Hives | Temperature, humidity |
| System | Uptime, solar output |

## Quick Start

```bash
# Pi setup (fresh Raspbian)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash
```

## Directory Structure

```
edge/
├── pi/          # Raspberry Pi: ChirpStack + ThingsBoard stack
└── heltec/      # Heltec LoRaWAN node firmware
```
