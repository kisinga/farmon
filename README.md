<p align="center">
  <img src="defaults/assets/logo.svg" alt="MajiFlow logo" width="120" height="120">
</p>

# MajiFlow

Code generator and desktop configurator for ESP32 water orchestration systems. Define your hardware topology — get compiled ESPHome firmware, HA dashboards, and safety watchdogs.

## Architecture

Three layers, each a separate concern:

1. **Board definition** (`boards/`) — what the hardware provides (MCU, peripherals, pin capabilities)
2. **System manifest** (`library/`) — what the user wires (tanks, valves, flow sensors, routes)
3. **Generated output** — complete flashable firmware + HA dashboard, driven by layers 1+2

The state machine (IDLE/PREPARING/RUNNING/STOPPING/FAULT) is static and board-agnostic. The codegen is board-agnostic — it checks capabilities, not board names. Adding a new board = writing one YAML file.

## Quick start

```bash
npm install
npm run dev
```

## Project structure

```
majiflow/
├── src/                          # Angular frontend (renderer process)
├── electron/                     # Electron main process + IPC handlers
│   └── lib/                      # Codegen, validation, generators
├── shared/                       # Types shared between Angular & Electron
├── test/                         # Integration + scaling tests
├── defaults/                     # Bundled board defs & example configs
│   ├── boards/                   # Board definitions (YAML + SVG)
│   └── configs/                  # Example system configs
├── public/                       # Static assets
├── legacy/                       # Previous custom stack
├── deploy/                       # Docker infrastructure
└── docs/                         # Documentation
```

## Generated files

| File | Driven by | Description |
|------|-----------|-------------|
| `common/board.yaml` | Board def | MCU, buses, battery, LED, fonts, diagnostics |
| `device.yaml` | Board + manifest | Substitutions, boot sequence, OLED display |
| `packages/routes.h` | Manifest | C++ route table + dispatch functions |
| `packages/hardware.yaml` | Manifest | Pump relay, valve switches + covers |
| `packages/sensors.yaml` | Manifest | Flow sensors, tank levels, calibration |
| `dashboards/pump.yaml` | Manifest | HA dashboard with gauges, controls, settings |

## Validation

Catches errors before they become firmware bugs:
- Pin conflicts, reserved pin usage, pin-not-on-board
- Per-pin capability checks (ADC for tanks, pulse_counter for flows)
- Route integrity, watchdog consistency, self-loops
- valve_mask overflow (max 16 per controller)
- GPIO budget (strict by default; `--loose` for I2C expanders)

## Tests

```bash
npm test            # 67 integration assertions
npm run test:limits # Scaling ceiling discovery
```

## Desktop app

Angular 20 + Electron + DaisyUI. Visual system editor with:
- Config library (list, create, duplicate, delete)
- Interactive board SVG with pin overlays
- Tabbed editor (device, tanks, valves, flows, routes, timing, topology)
- Real-time validation panel with GPIO budget bar
- Generate + compile + flash from the app
