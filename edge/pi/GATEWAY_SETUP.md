# SX1302 Gateway Setup

Setup guide for the Waveshare SX1302 LoRaWAN Gateway HAT.

## Prerequisites

- Raspberry Pi with SX1302 HAT connected
- SPI enabled: `sudo raspi-config` → Interface Options → SPI
- Docker stack running: `docker-compose up -d`

## Install Gateway

```bash
cd edge/pi
sudo bash setup_gateway.sh
```

This installs:
- `chirpstack-concentratord-sx1302` - SPI to ZeroMQ bridge
- `chirpstack-mqtt-forwarder` - ZeroMQ to MQTT bridge

## Verify

```bash
sudo systemctl status chirpstack-concentratord
sudo systemctl status chirpstack-mqtt-forwarder
sudo journalctl -fu chirpstack-concentratord
```

Gateway should appear in ChirpStack UI at `http://<pi-ip>:8080` → Gateways.

## Gateway Registration in ChirpStack

If `allow_unknown_gateways = true` in chirpstack.toml (default), the gateway auto-registers when it sends its first stats message.

**To manually register or after a database reset:**

1. Get gateway EUI:
   ```bash
   sudo journalctl -u chirpstack-mqtt-forwarder | grep -i "gateway_id"
   # Or check MQTT:
   docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/+/event/stats' -C 1 -v
   ```

2. In ChirpStack UI (`http://<pi-ip>:8080`):
   - Go to **Tenants** → Select tenant → **Gateways** → **Add gateway**
   - Gateway ID: Paste the 16-character EUI (e.g., `b827ebfffe123456`)
   - Name: `farm-gateway`
   - Select your tenant
   - Click **Submit**

3. Verify gateway is receiving:
   - Click on the gateway → **LoRaWAN frames** tab
   - You should see stats messages every 30 seconds

**Note:** After a database reset, all gateways, applications, devices, and device profiles are deleted. You must re-register everything.

## Configuration Files

| File | Purpose |
|------|---------|
| `/etc/chirpstack-concentratord/concentratord.toml` | HAT hardware config |
| `/etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml` | MQTT connection |
| `chirpstack/server/chirpstack.toml` | Network server |
| `chirpstack/server/region_*.toml` | Region channel plans |

## Waveshare HAT GPIO

| Signal | GPIO |
|--------|------|
| Reset | 23 |
| Power Enable | 18 |
| SPI | /dev/spidev0.0 |
| I2C Temp | 0x39 |

## Troubleshooting

### "Failed to set SX1250 in STANDBY_RC mode"
Wrong GPIO pins or HAT not seated. Check `/etc/chirpstack-concentratord/concentratord.toml`.

### Gateway shows "Never seen"
Topic prefix mismatch. Both MQTT Forwarder and ChirpStack must use same prefix:
```bash
cat /etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml | grep topic_prefix
# Should match region file: us915 or eu868
```

### SPI device not found
```bash
sudo raspi-config  # Enable SPI
sudo reboot
ls /dev/spidev*    # Should show spidev0.0
```

---

# End-to-End Device Setup

## 1. Create Application in ChirpStack

1. Open `http://<pi-ip>:8080`, login: admin/admin
2. Tenants → Applications → Add
3. Name: `farm-sensors`

## 2. Create Device Profile

1. Device profiles → Add
2. Name: `heltec-otaa`
3. Region: `US915` (or EU868)
4. MAC version: `LoRaWAN 1.0.3`
5. Join (OTAA/ABP) tab: Enable "Device supports OTAA"

## 3. Register Device

1. Applications → farm-sensors → Add device
2. Name: `remote-03`
3. Device EUI: From Heltec serial output on boot
4. Select device profile: `heltec-otaa`
5. After creation, go to OTAA Keys tab
6. Generate Application Key → Copy it

## 4. Update Heltec Config

Edit `edge/heltec/remote/config.h`:
```cpp
static const uint8_t LORAWAN_APP_KEY[16] = {
    // Paste your 16 bytes from ChirpStack
    0xAB, 0xCD, ...
};
```

## 5. Flash Device

```bash
cd edge/heltec
./heltec.sh build-upload remote
```

## 6. Verify

- Serial monitor shows "Successfully joined network"
- ChirpStack → Devices → LoRaWAN frames shows Join and Uplink
- Node-RED debug panel shows parsed data

---

# Node-RED Setup

## Install PostgreSQL Node

```bash
docker exec farm-nodered npm install node-red-contrib-postgresql
docker cp nodered/flows.json farm-nodered:/data/flows.json
docker restart farm-nodered
```

## Endpoints

| URL | Description |
|-----|-------------|
| `http://<pi>:1880` | Flow editor |
| `http://<pi>:1880/api/status` | Health check |
| `http://<pi>:1880/api/latest` | Latest reading per device |

## Test MQTT

```bash
docker exec farm-mosquitto mosquitto_pub \
  -t 'application/1/device/test123/event/up' \
  -m '{"deviceInfo":{"devEui":"test123"},"object":{"temp":25}}'
```

Check Node-RED debug panel for output.
