# Farmon Sensor Firmware (Heltec)

LoRaWAN firmware for Heltec ESP32 V3 sensor nodes.

## Setup

### 1. Get Credentials from ChirpStack

First, register your device in ChirpStack (see [../pi/README.md](../pi/README.md#register-each-device)).

Then get the Application Key:
1. ChirpStack → Applications → your app → Devices → your device
2. **OTAA keys** tab → Generate (or view existing)
3. Copy the 32-character hex string

### 2. Configure Secrets

```bash
cp secrets.example.h secrets.h
```

Edit `secrets.h` — convert the hex string to bytes:
```cpp
// ChirpStack shows: "0102030405060708090a0b0c0d0e0f10"
// Convert to:
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

## Commands

```bash
./heltec.sh flash              # Build + upload
./heltec.sh build              # Compile only  
./heltec.sh upload             # Upload only
./heltec.sh monitor            # Serial monitor (115200)
```

### Region Override

```bash
LORAWAN_REGION=EU868 ./heltec.sh flash    # EU868 instead of US915
LORAWAN_SUBBAND=1 ./heltec.sh flash       # Different sub-band
```

## Configuration

| File | Purpose |
|------|---------|
| `secrets.h` | LoRaWAN keys (gitignored) |
| `config.h` | Device name, region, ports |
| `remote_sensor_config.h` | Sensor settings |

## Device Info

- **DevEUI**: Auto-derived from ESP32 chip ID (unique per device)
- **AppEUI**: Usually all zeros for ChirpStack v4
- **AppKey**: From ChirpStack, stored in `secrets.h`
- **Region**: US915 sub-band 2 default (configurable)
- **Class**: A (battery-optimized)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Missing secrets.h` | Run `cp secrets.example.h secrets.h` |
| Not joining | Verify AppKey matches ChirpStack exactly |
| Wrong region | Check `LORAWAN_REGION` matches gateway |
| Upload fails | Hold PRG → press RST → release PRG → retry |
| Port not found | Add user to dialout: `sudo usermod -aG dialout $USER` |

## Prerequisites

```bash
# Install arduino-cli
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

# Add Heltec board support
arduino-cli config add board_manager.additional_urls \
  https://resource.heltec.cn/download/package_heltec_esp32_index.json
arduino-cli core install Heltec-esp32:esp32
```
