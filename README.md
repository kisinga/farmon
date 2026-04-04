# waterctl

Code generator for ESP32 water management systems. Describe your tanks, valves, pumps, and flow sensors in a YAML manifest — get compiled ESPHome firmware, HA dashboards, and safety watchdogs.

## How it works

1. Define your physical topology in a `system.yaml` manifest
2. Run the generator — it produces ESPHome YAML, C++ route tables, and HA dashboards
3. Flash to ESP32. The firmware runs a proven 5-state safety machine; the generator handles all the wiring

The state machine (IDLE/PREPARING/RUNNING/STOPPING/FAULT) is static and topology-agnostic. It never references specific valves or tanks. All routing goes through a compile-time route table generated from your manifest.

## Quick start

```bash
npm install

# Validate a manifest
npx tsx src/main.ts validate examples/pump-controller/system.yaml

# Generate firmware + dashboard
npx tsx src/main.ts generate examples/pump-controller/system.yaml

# Generate + compile + flash
npx tsx src/main.ts flash examples/pump-controller/system.yaml
npx tsx src/main.ts flash examples/pump-controller/system.yaml --device 192.168.1.50
```

## Manifest

```yaml
device:
  name: pump-ctrl
  friendly_name: Pump-ctrl
  board: heltec-v3

pump:
  pin: GPIO42

tanks:
  - name: Rain Tank
    id: tank1
    level_pin: GPIO19

valves:
  - name: Tank 1 Outlet
    id: valve1
    open_pin: GPIO4
    close_pin: GPIO5

flow_sensors:
  - name: House 2 Flow
    id: flow2
    pin: GPIO46

routes:
  - name: "T1>H2"
    source: tank1
    valves: [valve1, valve4]
    flow_sensor: flow2
    watchdog: flow
```

See [examples/pump-controller/system.yaml](examples/pump-controller/system.yaml) for a complete reference.

## What gets generated

| File | Purpose |
|------|---------|
| `packages/routes.h` | C++ route table, valve/tank/flow dispatch functions |
| `packages/hardware.yaml` | Pump relay (guarded), valve switches with interlocks, covers |
| `packages/sensors.yaml` | Flow sensors, tank levels, calibration numbers, state text |
| `_substitutions.yaml` | Pin mappings and timing constants |
| `dashboards/pump.yaml` | HA dashboard: gauges, route buttons, valve status, settings |

## What stays static

| File | Purpose |
|------|---------|
| `templates/control.yaml` | The state machine, API services, safety watchdog |
| `templates/common/heltec_board.yaml` | Board-level config (WiFi, I2C, SPI, battery, OLED) |

These never change per installation. The state machine is topology-agnostic.

## Validation

The generator catches errors before they become firmware bugs:

- Pin conflicts (same GPIO used twice)
- ADC pin validity (tank sensors must be on ADC-capable pins)
- Route integrity (missing valves, tanks, flow sensors)
- Watchdog consistency (flow watchdog requires a flow sensor)
- Self-loops (tank can't fill itself)
- valve_mask overflow (max 16 valves per controller)
- GPIO budget (strict by default; `--loose` for I2C expander setups)

## Tests

```bash
npm test            # Integration: generate from example, verify output
npm run test:limits # Scaling: find hardware ceilings
```

## Scaling limits

| Resource | Native Heltec V3 | With I2C expanders |
|----------|------------------|--------------------|
| Valves | 5 | 8 (MCP23017) |
| Tanks | ~10 | ~14 (ADS1115) |
| Flow sensors | ~6 | ~6 (native GPIO only) |
| Routes | unlimited | unlimited |

Multiple controllers coordinate through Home Assistant. Each ESP32 runs an independent state machine — HA schedules across zones.

## Project structure

```
waterctl/
├── src/                          # The generator
│   ├── main.ts                   # CLI: generate, validate, secrets, flash
│   ├── schema.ts                 # Zod manifest schema
│   ├── validate.ts               # Pre-generation checks
│   ├── generate.ts               # Orchestrator
│   └── generators/               # One per output file
├── test/
│   ├── codegen.test.ts           # Integration tests (87 assertions)
│   └── limits.test.ts            # Scaling limit tests
├── templates/                    # Static firmware (not generated)
│   ├── control.yaml              # State machine + safety watchdog
│   └── common/                   # Shared board config
├── examples/
│   └── pump-controller/          # Reference implementation
│       └── system.yaml
├── deploy/                       # Infrastructure (docker-compose, MQTT, etc.)
├── esphome/                      # Generated firmware output
├── config/                       # Generated HA config output
├── docs/
└── legacy/                       # Previous custom stack (reference only)
```

## Deploy infrastructure

The `deploy/` directory contains Docker Compose and service configs for running the full stack (Home Assistant, ChirpStack, Mosquitto, ESPHome) on a Raspberry Pi:

```bash
cd deploy && docker compose up -d
```
