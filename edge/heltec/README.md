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
./heltec.sh flash
```

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
| `./heltec.sh flash` | Build and upload |
| `./heltec.sh build` | Compile only |
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
| `config.h` | Device name, region, debug mode |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Missing secrets.h` | `cp secrets.example.h secrets.h` |
| Not joining | Check AppKey matches ChirpStack exactly |
| Upload fails | Hold PRG → press RST → release PRG → retry |
| Port not found | `sudo usermod -aG dialout $USER`, then logout/login |

## Prerequisites

```bash
# Install arduino-cli
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

# Add Heltec board support
arduino-cli config add board_manager.additional_urls \
  https://resource.heltec.cn/download/package_heltec_esp32_index.json
arduino-cli core install Heltec-esp32:esp32
```
