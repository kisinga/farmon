# Sensor System

Sensors implement **ISensor**; device wires them via **setupDeviceSensors** in `devices/<name>/device_setup.h`. See [docs/FIRMWARE_ARCHITECTURE.md](../docs/FIRMWARE_ARCHITECTURE.md).

## Contract

- **ISensor**: `begin()`, `read(std::vector<SensorReading>&)`, `getName()`.
- **SensorManager**: `addSensor(shared_ptr<ISensor>)`, `readAll()` → vector of SensorReading (type, value, timestamp).
- **Sensor-defined config**: Each sensor type in lib has a config struct (e.g. `SensorConfig::YFS201WaterFlow`: pin, enabled, persistence_namespace). `RemoteSensorConfig` aggregates them; device fills in `buildDeviceSensorConfig()`.

## Lib Sensors

| Sensor | Config | Notes |
|--------|--------|--------|
| YFS201WaterFlowSensor | SensorConfig::YFS201WaterFlow | Pulse count + total volume; persistence namespace. |
| BatteryMonitorSensor | SensorConfig::BatteryMonitor | enabled; uses IBatteryHal. |

## Factory

- `SensorFactory::createYFS201WaterFlowSensor(cfg, persistenceHal)` or legacy (pin, enabled, persistenceHal, namespace).
- `SensorFactory::createBatteryMonitorSensor(batteryHal, cfg)` or (batteryHal, enabled).

## Device Setup

In `device_setup.h`: create sensors from `RemoteSensorConfig` (SensorFactory + config structs), add to SensorManager in **schema field order** (pd, tv, bp) so `readAll()` order matches rule evaluation. Optionally set `outWaterFlow` for persistence task and port-10 reset.

## Integrations

Integrations (e.g. `integrations/inverter_pump.h`) implement ISensor and/or IControlDriver. Device includes the integration, instantiates with config and IUartHal, adds to SensorManager and registers control driver. Same sensor/integration type can have different configs per device.
