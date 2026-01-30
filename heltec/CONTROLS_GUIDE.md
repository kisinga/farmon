# Controls Guide

Controls are defined in the **schema** (device_config.h) and **wired** in **device_setup.h** via IControlDriver. See [docs/FIRMWARE_ARCHITECTURE.md](../docs/FIRMWARE_ARCHITECTURE.md).

## Current (main/remote1)

| Index | Key | States | Driver |
|-------|-----|--------|--------|
| 0 | pump | off, on | NoOpControlDriver |
| 1 | valve | closed, open | NoOpControlDriver |

## How It Works

1. **Schema**: `buildDeviceSchema()` calls `.addControl("pump", "Water Pump", {"off", "on"})`. Control index = order added.
2. **Driver**: Implement **IControlDriver** (lib or integration): `bool setState(uint8_t state_idx)`.
3. **Registration**: In `registerDeviceControls(engine)` (device_setup.h): create driver (e.g. static NoOpControlDriver), `engine.registerControl(idx, &driver)`.
4. **Trigger**: Edge rules (evaluate after telemetry) or downlink (fPort 20) call driver->setState().

## Lib Drivers

- **NoOpControlDriver** (label): Logs only; use for testing or stub.
- **GpioRelayDriver** (pin): state_idx 0 = LOW, non-zero = HIGH; calls begin() on first setState.

## Adding a Control

1. **Schema** (device_config.h): `.addControl("light", "Grow Light", {"off", "on"})`. Index = next (e.g. 2).
2. **Driver**: Use existing (NoOp, GpioRelay) or add lib/integration driver implementing IControlDriver.
3. **device_setup.h**: In `registerDeviceControls`, add e.g. `static NoOpControlDriver lightDriver("Light"); engine.registerControl(2, &lightDriver);`

## Limits

- **MAX_CONTROLS**: 16 (message_schema.h, edge_rules.h).
- **MAX_STATES_PER_CONTROL**: 4.
