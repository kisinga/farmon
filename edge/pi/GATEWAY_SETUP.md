# SX1302 Gateway & End-to-End Setup

This guide covers the complete setup from gateway hardware through to Node-RED data visualization.

## Architecture

```
┌─────────────────┐
│   SX1302 HAT    │  (Waveshare LoRaWAN HAT)
└────────┬────────┘
         │ SPI
┌────────▼────────┐
│  Concentratord  │  ← systemd service (native binary)
└────────┬────────┘
         │ ZeroMQ IPC
┌────────▼────────┐
│  MQTT Forwarder │  ← systemd service (native binary)
└────────┬────────┘
         │ MQTT (port 1883)
┌────────▼────────┐
│    Mosquitto    │  ← Docker container
└────────┬────────┘
         │ MQTT
┌────────▼────────┐
│   ChirpStack    │  ← Docker container
└─────────────────┘
```

**Why this architecture:**
- Concentratord provides native SX1302 hardware access via SPI
- MQTT Forwarder bridges Concentratord to MQTT (ChirpStack's gateway protocol)
- Both run as systemd services on the host (hardware access required)
- ChirpStack and dependencies run in Docker (easier management)

## Setup

### Prerequisites
- Raspberry Pi with SX1302 HAT connected
- SPI enabled (`sudo raspi-config` → Interface Options → SPI)
- Docker stack running (`docker-compose up -d`)

### Install Gateway Components

```bash
cd /home/raspberrypi/farm/edge/pi
sudo bash setup_gateway.sh
```

This installs and configures:
- `chirpstack-concentratord-sx1302` - Hardware abstraction
- `chirpstack-mqtt-forwarder` - MQTT bridge

### Verify

```bash
# Check services
sudo systemctl status chirpstack-concentratord
sudo systemctl status chirpstack-mqtt-forwarder

# View logs
sudo journalctl -fu chirpstack-concentratord
sudo journalctl -fu chirpstack-mqtt-forwarder
```

## ChirpStack Gateway Registration

The gateway should auto-register (if `allow_unknown_gateways = true`).

1. Open ChirpStack: `http://<pi-ip>:8080`
2. Login: `admin` / `admin`
3. Go to **Gateways** - your gateway should appear
4. Click to view stats and last-seen timestamp

If not appearing:
- Check MQTT Forwarder logs: `sudo journalctl -fu chirpstack-mqtt-forwarder`
- Verify Mosquitto is running: `docker ps | grep mosquitto`

## Configuration Files

| File | Purpose |
|------|---------|
| `/etc/chirpstack-concentratord/concentratord.toml` | Hardware config (SPI, GPIO pins, model) |
| `/etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml` | MQTT connection and topic prefix |
| `chirpstack/server/chirpstack.toml` | Network server config (region, MQTT backend) |

## Waveshare SX1302 HAT Notes

**GPIO Pin Mapping (Waveshare SX1302 LoRaWAN Gateway HAT):**
- Reset: GPIO 23
- Power Enable: GPIO 18
- SPI: `/dev/spidev0.0`
- I2C Temp Sensor: 0x39

If your HAT uses different pins, edit:
```bash
sudo nano /etc/chirpstack-concentratord/concentratord.toml
```

## Troubleshooting

### SPI device not found
```bash
# Enable SPI
sudo raspi-config  # Interface Options → SPI → Enable
sudo reboot
```

### Concentratord fails to start
```bash
# Check logs
sudo journalctl -u chirpstack-concentratord -n 50

# Common issues:
# - SPI not enabled
# - Wrong reset pin (Waveshare uses GPIO 23, not 17)
# - Missing power enable pin (GPIO 18)
# - HAT not properly seated
```

### "Failed to set SX1250 in STANDBY_RC mode" error
This indicates the radio frontend isn't initializing. Usually caused by:

1. **Wrong GPIO pins**: Waveshare HAT uses GPIO 23 (reset) and GPIO 18 (power enable)
2. **Wrong model**: Must use `waveshare_sx1302_lorawan_gateway_hat`
3. **HAT not seated properly**: Power off, reseat the HAT, power on

```bash
# Test hardware with Waveshare's official tool
cd ~
git clone https://github.com/siuwahzhong/sx1302_hal.git
cd sx1302_hal && git checkout ws-dev && make clean all
cp tools/reset_lgw.sh util_chip_id/
cd util_chip_id && sudo ./chip_id
# Should show: concentrator EUI: 0x...
```

### Gateway not appearing in ChirpStack
```bash
# Check MQTT connection
docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/#' -v -C 3

# Should see gateway stats every 30s
```

### Gateway shows "Never seen" in ChirpStack
This means ChirpStack is not receiving MQTT messages from the gateway.

**Common causes:**
1. **Region mismatch**: ChirpStack config has wrong region (e.g., EU868 instead of US915)
   ```bash
   # Check what topic ChirpStack is subscribing to
   docker logs farm-chirpstack --tail 20 | grep -i subscrib
   # Should show: region_id=us915_0
   ```

2. **ChirpStack MQTT connection failed**: ChirpStack started before Mosquitto was ready
   ```bash
   # Restart ChirpStack
   docker restart farm-chirpstack
   ```

3. **Topic prefix mismatch**: MQTT Forwarder and ChirpStack using different prefixes
   ```bash
   # Check MQTT Forwarder topic
   cat /etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml | grep topic_prefix
   # Check ChirpStack topic
   docker exec farm-chirpstack cat /etc/chirpstack/chirpstack.toml | grep topic_prefix
   # Both should be "us915"
   ```

### Permission denied on SPI
```bash
# Add user to spi group (if not running as root)
sudo usermod -aG spi $USER
```

## Services Management

```bash
# Restart gateway services
sudo systemctl restart chirpstack-concentratord chirpstack-mqtt-forwarder

# Stop gateway
sudo systemctl stop chirpstack-mqtt-forwarder chirpstack-concentratord

# Disable auto-start
sudo systemctl disable chirpstack-concentratord chirpstack-mqtt-forwarder
```

---

## End-to-End Device Connection

Once the gateway is online in ChirpStack, follow these steps to connect your Heltec device.

### Step 1: Create Application in ChirpStack

1. Open ChirpStack: `http://<pi-ip>:8080`
2. Login: `admin` / `admin`
3. Go to **Tenants** → Select default tenant
4. Go to **Applications** → **Add application**
   - Name: `farm-sensors`
   - Description: `Farm monitoring sensors`
5. Click **Submit**

### Step 2: Create Device Profile

1. Go to **Device profiles** → **Add device profile**
2. **General tab:**
   - Name: `heltec-otaa-class-a`
   - Region: `US915` (or your region)
   - MAC version: `LoRaWAN 1.0.3`
   - Regional parameters revision: `A`
   - ADR algorithm: `Default ADR algorithm`
3. **Join (OTAA/ABP) tab:**
   - Check: `Device supports OTAA`
4. **Class-B/C tabs:** Leave defaults (Class A only)
5. **Codec tab:** (Optional) Add a JavaScript decoder:

```javascript
// Decode uplink function
function decodeUplink(input) {
  var data = {};
  var bytes = input.bytes;
  
  // Example: Parse your telemetry format
  // Adjust based on your actual payload structure
  if (bytes.length >= 4) {
    data.battery = bytes[0];
    data.temperature = (bytes[1] << 8 | bytes[2]) / 100.0;
    data.water_volume = (bytes[3] << 8 | bytes[4]) / 10.0;
  }
  
  return { data: data };
}
```

6. Click **Submit**

### Step 3: Register Your Device

1. Go to **Applications** → `farm-sensors` → **Add device**
2. **Device tab:**
   - Name: `remote-03` (or your device name)
   - Device EUI: Get from your Heltec device serial output or chip ID
     ```bash
     # On your computer with Heltec connected:
     # Open serial monitor at 115200 baud, device will print DevEUI on boot
     ```
   - Device profile: Select `heltec-otaa-class-a`
3. Click **Submit**
4. **OTAA keys tab** (after device is created):
   - Application key: Click **Generate** or enter your own 32-hex-char key
   - **Copy this Application Key** - you'll need it for the device config

### Step 4: Update Heltec Device Configuration

Edit `edge/heltec/remote/config.h` with the keys from ChirpStack:

```cpp
// AppEUI (JoinEUI) - usually all zeros for ChirpStack v4
static const uint8_t LORAWAN_APP_EUI[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// AppKey - paste the key from ChirpStack (32 hex chars → 16 bytes)
// Example: If ChirpStack shows "01020304050607080910111213141516"
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16
};
```

### Step 5: Flash the Heltec Device

```bash
cd edge/heltec
./heltec.sh build-upload remote
```

The device will boot and attempt to join. Monitor via serial:
```bash
# Open serial monitor (e.g., using Arduino IDE or screen)
screen /dev/ttyUSB0 115200
```

You should see:
```
LoRaWAN: Starting join process
LoRaWAN: Successfully joined network
```

### Step 6: Verify in ChirpStack

1. Go to **Applications** → `farm-sensors` → your device
2. Check **LoRaWAN frames** tab - you should see:
   - `JoinRequest` and `JoinAccept` frames
   - `UnconfirmedDataUp` frames with your telemetry

---

## Node-RED Connection

Node-RED receives device data via MQTT from ChirpStack.

### Step 1: Verify Node-RED is Running

```bash
docker ps | grep nodered
# Should show: farm-nodered ... Up ...
```

Access Node-RED: `http://<pi-ip>:1880`

### Step 2: Install Required Nodes

In Node-RED, go to **Menu** (☰) → **Manage palette** → **Install tab**

Search and install:
- `node-red-contrib-postgresql` (for database storage)

### Step 3: Import the Flow

1. Go to **Menu** (☰) → **Import**
2. Copy the contents of `edge/pi/nodered/flows.json`
3. Paste and click **Import**
4. Click **Deploy**

### Step 4: Verify MQTT Connection

1. In the Node-RED flow, double-click the **ChirpStack Events** node
2. Verify the MQTT broker is configured:
   - Server: `mosquitto` (Docker network name)
   - Port: `1883`
3. The node should show a green "connected" status

### Step 5: Reinitialize Database (if needed)

If you're setting up fresh or changed the database schema:

```bash
# Stop and remove postgres volume to reinitialize
docker-compose down
docker volume rm farm_postgres_data  # or: sudo rm -rf /srv/farm/postgres/*
docker-compose up -d
```

### Step 6: Test the Connection

1. Power on your Heltec device
2. Watch the **Debug** panel in Node-RED (right sidebar)
3. You should see parsed uplink messages

### Verify Data in PostgreSQL

```bash
# Connect to database
docker exec -it farm-postgres psql -U farmmon -d farmmon

# Query readings
SELECT * FROM readings ORDER BY ts DESC LIMIT 10;

# Exit
\q
```

---

## MQTT Topic Reference

ChirpStack publishes events to these MQTT topics:

| Topic Pattern | Description |
|--------------|-------------|
| `application/{app_id}/device/{dev_eui}/event/up` | Uplink data |
| `application/{app_id}/device/{dev_eui}/event/join` | Device join |
| `application/{app_id}/device/{dev_eui}/event/ack` | Downlink ACK |
| `application/{app_id}/device/{dev_eui}/event/txack` | TX acknowledgment |
| `application/{app_id}/device/{dev_eui}/event/status` | Device status |

To send downlinks:
| Topic Pattern | Description |
|--------------|-------------|
| `application/{app_id}/device/{dev_eui}/command/down` | Queue downlink |

### Test MQTT Manually

```bash
# Subscribe to all device events
docker exec farm-mosquitto mosquitto_sub -t 'application/#' -v

# Subscribe to gateway traffic (for debugging)
docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/#' -v
```
