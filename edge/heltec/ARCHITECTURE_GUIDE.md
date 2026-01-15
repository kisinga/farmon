# Farm Monitoring System Architecture Guide (v3.0)

## Overview

This document describes the architecture of the Farm Monitoring System, a LoRaWAN-based IoT solution for remote environmental monitoring. The system uses Heltec ESP32 LoRa V3 devices as LoRaWAN Class A end devices that communicate with a LoRaWAN gateway and network server (ChirpStack).

---

## System Architecture

### High-Level Data Flow

```
┌─────────────────┐     LoRaWAN      ┌─────────────────┐
│  Remote Node    │ ───────────────► │  SX1302 Gateway │
│  (Heltec V3)    │                  │  (Raspberry Pi) │
└─────────────────┘                  └────────┬────────┘
                                              │ UDP
                                              ▼
                                     ┌─────────────────┐
                                     │   ChirpStack    │
                                     │ (Network Server)│
                                     └────────┬────────┘
                                              │ MQTT
                                              ▼
                                     ┌─────────────────┐
                                     │   ThingsBoard   │
                                     │ (Dashboard/DB)  │
                                     └─────────────────┘
```

### Key Design Principles

- **LoRaWAN Standard**: Uses standard LoRaWAN 1.0.3 protocol for reliable, long-range communication
- **OTAA Join**: Devices use Over-The-Air Activation with derived DevEUI and shared AppEUI/AppKey
- **Class A Operation**: Power-efficient operation with uplink-initiated downlink windows
- **Modular Architecture**: Five-layer design promoting separation of concerns

---

## Five-Layer Architecture

```
┌───────────────────────────────────────────┐
│  5. Application Layer (`remote_app.h`)    │  ← Device business logic
│     (RemoteApplication)                   │
├───────────────────────────────────────────┤
│  4. Services Layer (`svc_*.h`)            │  ← High-level features
│     (LoRaWANService, UiService, etc.)     │
├───────────────────────────────────────────┤
│  3. UI Components (`ui_*.h`)              │  ← Reusable UI elements
│     (ui_text_element, ui_layout)          │
├───────────────────────────────────────────┤
│  2. Hardware Abstraction Layer (`hal_*.h`)│  ← Hardware interfaces
│     (ILoRaWANHal, IDisplayHal)            │
├───────────────────────────────────────────┤
│  1. Core Layer (`core_*.h`)               │  ← Foundational utilities
│     (core_config, core_scheduler)         │
└───────────────────────────────────────────┘
```

---

## Layer Details

### Layer 1: Core Layer (`core_*.h`)

Foundational building blocks for the system.

| File | Description |
|------|-------------|
| `core_config.h/.cpp` | Device configuration with LoRaWAN credentials |
| `core_scheduler.h/.cpp` | Task scheduler for periodic operations |
| `core_logger.h` | Logging utility with multiple log levels |
| `core_system.h/.cpp` | System initialization orchestration |

### Layer 2: Hardware Abstraction Layer (`hal_*.h`)

Decouples application from hardware specifics.

| File | Description |
|------|-------------|
| `hal_lorawan.h/.cpp` | LoRaWAN radio interface (`ILoRaWANHal`) |
| `hal_display.h/.cpp` | OLED display interface (`IDisplayHal`) |
| `hal_battery.h/.cpp` | Battery monitoring interface (`IBatteryHal`) |
| `hal_persistence.h` | Flash storage interface (`IPersistenceHal`) |
| `hal_wifi.h/.cpp` | WiFi interface (optional, `IWifiHal`) |

### Layer 3: UI Components (`ui_*.h`)

Reusable UI elements for the OLED display.

| File | Description |
|------|-------------|
| `ui_element.h` | Base class for all UI elements |
| `ui_layout.h` | Base class for layout containers |
| `ui_text_element.h` | Text display element |
| `ui_battery_icon_element.h` | Battery status icon |
| `ui_header_status_element.h` | Connection status indicator |

### Layer 4: Services Layer (`svc_*.h`)

High-level services built on HAL and Core layers.

| File | Description |
|------|-------------|
| `svc_lorawan.h/.cpp` | LoRaWAN communication service |
| `svc_ui.h/.cpp` | Display management service |
| `svc_comms.h/.cpp` | Multi-transport communication service |
| `svc_battery.h/.cpp` | Battery monitoring service |

### Layer 5: Application Layer

Device-specific business logic.

| File | Description |
|------|-------------|
| `remote_app.h/.cpp` | Remote sensor node application |
| `remote.ino` | Arduino entry point |

---

## LoRaWAN Integration

### Device Provisioning

- **DevEUI**: Derived from ESP32 chip ID (unique per device)
- **AppEUI**: Shared across all devices in the fleet
- **AppKey**: Shared secret for OTAA join (stored in `config.h`)

### Port-Based Message Routing

| Port | Direction | Purpose |
|------|-----------|---------|
| 1 | Uplink | Telemetry data (default) |
| 10 | Downlink | Reset water volume command |
| 11 | Downlink | Set reporting interval |
| 12 | Downlink | Reboot device |

### Telemetry Payload Format

Compact text format for efficient transmission:
```
key:value,key:value,...

Example: bat:85,pd:12,vol:45.23,err:0,tsr:3600
```

Keys defined in `telemetry_keys.h`:
- `bat` - Battery percentage
- `pd` - Pulse delta (water flow)
- `vol` - Total volume (liters)
- `err` - Error count
- `tsr` - Time since reset (seconds)

---

## Configuration

### RemoteConfig Structure

```cpp
struct RemoteConfig : DeviceConfig {
    // Sensor settings
    bool enableAnalogSensor;
    uint32_t telemetryReportIntervalMs;
    
    // LoRaWAN settings (via communication.lorawan)
    // - appEui[8]
    // - appKey[16]
    // - region
    // - defaultPort
    // - useConfirmedUplinks
};
```

### Per-Device Configuration

Device-specific settings in `remote/config.h`:
- Device ID and name
- LoRaWAN credentials (AppEUI, AppKey)
- Sensor enable/disable flags

---

## Adding New Features

### Adding a New Sensor

1. Create sensor class implementing `ISensor` in `sensor_implementations.hpp`
2. Add configuration to `remote_sensor_config.h`
3. Register sensor in `RemoteApplicationImpl::setupSensors()`
4. Add telemetry key to `telemetry_keys.h`

### Adding a New Downlink Command

1. Define port number (10-99 recommended for commands)
2. Add case to `RemoteApplicationImpl::onDownlinkReceived()`
3. Document in this guide and ChirpStack device profile

---

## Key Takeaways

1. **LoRaWAN Standard**: Uses proven, industry-standard protocol
2. **Derived DevEUI**: Each device gets unique ID from chip
3. **Port-Based Commands**: Clean separation of message types
4. **Modular Design**: Easy to extend with new sensors and commands
5. **Gateway Independence**: Devices are standard LoRaWAN end devices
