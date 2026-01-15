# Heltec LoRaWAN Firmware

Firmware for Heltec ESP32 LoRaWAN nodes that collect sensor data and transmit to ChirpStack via the SX1302 gateway.

## Data Flow

```
Heltec Node → SX1302 Gateway → ChirpStack → ThingsBoard
   (LoRa)         (UDP)         (MQTT)      (dashboard)
```

## Setup (Arduino IDE)

### Prerequisites

- Arduino IDE 2.x
- USB data cable (CP210x driver may be required)

### Install Heltec Board Support

1. File → Preferences → Additional Boards Manager URLs:
   ```
   https://resource.heltec.cn/download/package_heltec_esp32_index.json
   ```
2. Tools → Board → Boards Manager → search "heltec esp32" → Install
3. Tools → Board → Select your model (e.g., "Heltec WiFi LoRa 32 (V3)")

### Build and Upload

1. Select board and port in Tools menu
2. Verify/Upload sketch
3. If upload fails: hold PRG, press RST, release PRG (enters bootloader)

## Linux Serial Setup

```bash
# Add user to serial group
sudo usermod -aG dialout $USER
# Log out and back in

# Install pyserial if needed
python3 -m pip install --user pyserial

# Stop ModemManager if it grabs the port
sudo systemctl stop ModemManager
```

Verify device: `ls /dev/ttyUSB*` or `dmesg -w` while plugging in.

## Project Structure

| Path | Description |
| ---- | ----------- |
| `remote/` | Sensor node firmware and libraries |
| `remote/lib/` | Shared library code (HALs, services, UI) |
| `ARCHITECTURE_GUIDE.md` | System architecture documentation |
| `LORAWAN_SETUP.md` | ChirpStack and device provisioning guide |

## Troubleshooting

- **Board not visible**: Restart IDE after installing board core
- **Wrong board selected**: Causes missing header errors; select exact Heltec model
- **Port not found**: Check cable, add user to `dialout` group, stop ModemManager
