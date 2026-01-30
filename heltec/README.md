# Farmon Sensor Firmware (Heltec)

LoRaWAN firmware for Heltec ESP32 V3 sensor nodes.

## Setup

### 1. Register Device in ChirpStack

Before flashing, register the device to get credentials.

If you don't have the DevEUI yet, flash first with placeholder secrets, then check serial output.

→ See [../pi/README.md#add-device](../pi/README.md#add-device)

### 2. Configure Secrets

```bash
cp secrets.example.h secrets.h
```

Edit `secrets.h` with your Application Key from ChirpStack:

```cpp
// ChirpStack shows: "0102030405060708090a0b0c0d0e0f10"
// Convert each pair to 0xNN:
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
};
```

### 3. Build and Flash

```bash
./heltec.sh build main    # or remote1
./heltec.sh flash main
```

Device selection: `main` or `remote1` (devices in `devices/<name>/`). Schema and sensor/control wiring are per device. See [../docs/FIRMWARE_ARCHITECTURE.md](../docs/FIRMWARE_ARCHITECTURE.md).

### 4. Verify

```bash
./heltec.sh monitor
```

Look for:
```
DevEUI: XX:XX:XX:XX:XX:XX:XX:XX
Starting LoRaWAN OTAA join...
Successfully joined network
```

Also check ChirpStack → Device → LoRaWAN frames for join and uplink messages.

## Commands

| Command | Action |
|---------|--------|
| `./heltec.sh build <device>` | Compile for main or remote1 |
| `./heltec.sh flash <device>` | Build and upload |
| `./heltec.sh monitor` | Serial monitor |

### Region Override

```bash
LORAWAN_REGION=EU868 ./heltec.sh flash   # EU868 instead of US915
LORAWAN_SUBBAND=1 ./heltec.sh flash      # Different sub-band
```

## Configuration Files

| File | Purpose |
|------|---------|
| `secrets.h` | LoRaWAN keys (gitignored) |
| `devices/<name>/device_config.h` | Schema, buildDeviceConfig, buildDeviceSensorConfig |
| `devices/<name>/device_setup.h` | setupDeviceSensors, registerDeviceControls |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Missing secrets.h` | `cp secrets.example.h secrets.h` |
| Not joining | Check AppKey matches ChirpStack exactly |
| Upload fails | Hold PRG → press RST → release PRG → retry |
| Port not found | `sudo usermod -aG dialout $USER`, then logout/login |

## Prerequisites

### Quick Setup (Recommended)

Run the automated setup script:

```bash
./setup_build_env.sh
```

This will:
- Install/configure `arduino-cli` if needed
- Add ESP32 board support (Espressif official package)
- Verify the Heltec_ESP32_LoRa_v3 library is installed

### Manual Setup

If you prefer manual setup:

```bash
# Install arduino-cli
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

# Add ESP32 board support (Espressif official, not Heltec)
arduino-cli config add board_manager.additional_urls \
  https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32

# Install Heltec library (via Arduino IDE Library Manager or):
# Search for "heltec_esp32_lora_v3" by Rop Gonggrijp
```

**Important:** This project uses the `ropg/Heltec_ESP32_LoRa_v3` library (not the broken official Heltec library). It works with the standard ESP32 board package from Espressif.
