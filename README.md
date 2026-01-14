![far-mon Logo](docs/images/far-mon.png)

# far-mon

**Monitor your farm. From far. Farm on!**

A modular, resilient farm-monitoring platform that consolidates sensor data and integrates with ERPNext (or any farm ERP) for unified record-keeping and analytics.

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
                                       │  ChirpStack     │
                                       │  MQTT / Node-RED│
                                       │  InfluxDB       │
                                       └────────┬────────┘
                                                │ Tailscale VPN
                                                ▼
                                       ┌─────────────────┐
                                       │ Remote Access   │
                                       │ ERPNext / Cloud │
                                       └─────────────────┘
```

- **Heltec Nodes** – LoRaWAN Class A devices with sensors (soil, water, environment)
- **SX1302 Gateway** – Receives LoRa packets, forwards to Pi via UDP
- **Raspberry Pi** – Runs ChirpStack (LoRaWAN network server), MQTT, Node-RED, InfluxDB
- **Remote Access** – Tailscale VPN for secure management; data flows to ERPNext/dashboards

## Capabilities

| Domain    | Measurements                    | Hardware                         |
| --------- | ------------------------------- | -------------------------------- |
| Water     | Tank level, borehole flow, rain | HC-SR04, flow sensors, API       |
| Soil      | Moisture                        | Capacitive probes                |
| Livestock | Weight, health                  | Manual scale or RFID gate        |
| Fodder    | Harvest time, regrowth          | Logs + moisture probe            |
| Hives     | Temp, humidity, activity        | Thermal probe, IR motion counter |
| System    | Uptime, solar output            | Pulse counters, shunt sensors    |

## Quick Start

```bash
# Pi setup (fresh Raspbian)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash
```

See [edge/pi/README.md](edge/pi/README.md) for detailed setup instructions.

## Directory Structure

```
edge/
├── pi/          # Raspberry Pi: ChirpStack, Docker stack, setup scripts
└── heltec/      # Heltec LoRaWAN node firmware (remote sensors)
```

## ERPNext Integration Roadmap

1. Device Registry for sensor metadata
2. Time-Series Bridge (Pi → MQTT/REST → ERPNext)
3. Offline Mobile Forms (livestock, crops, maintenance)
4. Auto-Reports for yield, water use, field conditions
