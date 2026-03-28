# ESPHome — Farm Devices

## Devices

| Device | Root Config | Board | Purpose |
|--------|-------------|-------|---------|
| Heltec V3 | `heltec/heltec.yaml` | Heltec WiFi LoRa 32 V3 | Standalone monitoring + OLED |
| Pump Controller | `pump-controller/pump-controller.yaml` | Heltec WiFi LoRa 32 V3 | Water pump + valve orchestration + OLED |

Both devices run on the Heltec V3 and share a common board package.

## Structure

```
esphome/
├── common/                              # Shared across all Heltec V3 devices
│   ├── heltec_board.yaml                # Board, buses, Vext, LED, networking,
│   │                                    # battery, common sensors, fonts, images
│   └── images/
│       └── logo.svg                     # Farm logo (compiled to 1-bit bitmap)
│
├── heltec/                              # Standalone monitoring device
│   ├── heltec.yaml                      # ← compile this
│   └── secrets.yaml
│
├── pump-controller/                     # Pump control device
│   ├── pump-controller.yaml             # ← compile this
│   ├── packages/
│   │   ├── hardware.yaml                # Relay, solenoid, valve pins, covers
│   │   ├── sensors.yaml                 # Flow, tank levels, state text
│   │   └── control.yaml                 # State machine, API services, scripts, safety
│   └── secrets.yaml
│
└── README.md
```

### How it composes

```
common/heltec_board.yaml          ← base: board, buses, networking, battery, sensors, fonts
        │
        ├── heltec/heltec.yaml    ← extends with: telemetry display
        │
        └── pump-controller/pump-controller.yaml
                │                 ← extends with: pump display (state machine)
                ├── packages/hardware.yaml
                ├── packages/sensors.yaml
                └── packages/control.yaml
```

Each device defines its own OLED `display:` component with device-specific content.
The top bar (battery icon, WiFi bars) and splash screen are drawn per-device
using shared font and image IDs from the common board package.

## Setup

### Install ESPHome

```bash
pip install esphome
```

### Secrets

Each device directory needs a `secrets.yaml` (gitignored):

```yaml
wifi_ssid: "your-ssid"
wifi_password: "your-password"
fallback_password: "fallback-ap-password"
api_key: "base64-encoded-32-byte-key"
ota_password: "ota-password"
```

Generate an API key:

```bash
python3 -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
```

## Commands

All commands run from the **repo root** (`farm/`).

### Heltec V3

```bash
esphome config  esphome/heltec/heltec.yaml              # validate
esphome compile esphome/heltec/heltec.yaml              # build
esphome run     esphome/heltec/heltec.yaml              # flash USB
esphome run     esphome/heltec/heltec.yaml --device IP  # flash OTA
esphome logs    esphome/heltec/heltec.yaml              # serial logs
```

### Pump Controller

```bash
esphome config  esphome/pump-controller/pump-controller.yaml
esphome compile esphome/pump-controller/pump-controller.yaml
esphome run     esphome/pump-controller/pump-controller.yaml
esphome run     esphome/pump-controller/pump-controller.yaml --device IP
esphome logs    esphome/pump-controller/pump-controller.yaml
```

First compile downloads the ESP-IDF toolchain (~500MB). Subsequent compiles are fast.

### Troubleshooting: PlatformIO Python Modules

If compile fails with `ModuleNotFoundError` for `fatfs` or `littlefs`:

```bash
~/.platformio/penv/bin/pip install fatfs littlefs-python
```

Or compile from the ESPHome Dashboard on the RPi where dependencies are pre-installed.

## Architecture

### Common Board (`common/heltec_board.yaml`)

Provides everything shared across Heltec V3 devices:
ESP32-S3 config, I2C/SPI buses, Vext gate, LED, WiFi, API, OTA,
battery monitoring, WiFi/uptime/temp sensors, fonts, and logo images.

Requires substitutions from the including config:
`${friendly_name}`, `${update_interval}`, `${pin_battery_adc}`, `${battery_divider}`

### Pump Controller State Machine

`IDLE → PREPARING → RUNNING → STOPPING → IDLE`, with `FAULT` reachable from `RUNNING`.

Three composable packages:

| Package | Layer | Extends when... |
|---------|-------|-----------------|
| `hardware.yaml` | Physical actuators | Adding valves, pumps, solenoids |
| `sensors.yaml` | Measurements | Adding pressure, rain, new tanks |
| `control.yaml` | Orchestration | New pump paths, watchdog rules, services |

`close_all_valves` script is the single edit point when adding/removing valves.

See quick-reference table in `pump-controller.yaml` header for states, faults, and valid routing.

### Adding a New Heltec V3 Device

1. Create `esphome/<device-name>/` directory
2. Create `<device-name>.yaml` with substitutions + `packages: board: !include ../common/heltec_board.yaml`
3. Define `esphome:` (name, on_boot), `display:` (splash + device-specific runtime page)
4. Add device-specific packages as needed
5. Copy `secrets.yaml` into the directory
