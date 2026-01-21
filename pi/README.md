# Farmon Gateway (Raspberry Pi)

ChirpStack + Node-RED + PostgreSQL on Raspberry Pi with SX1302 LoRaWAN HAT.

## Setup

### 1. Run Setup Script

```bash
# Fresh Pi - run as regular user (not root)
curl -sSL https://github.com/kisinga/farmon/raw/main/pi/setup_farm_pi.sh | bash
```

This installs Docker, clones the repo, and starts all services.

## Gateway Hardware

### Waveshare HAT GPIO

| Signal | GPIO |
|--------|------|
| Reset | 23 |
| Power Enable | 18 |
| SPI | /dev/spidev0.0 |


### Gateway Config Files

| File | Purpose |
|------|---------|
| `/etc/chirpstack-concentratord/concentratord.toml` | Hardware config |
| `/etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml` | MQTT connection |

### 2. Install Gateway HAT

Prerequisite: Enable SPI via `sudo raspi-config` → Interface Options → SPI

```bash
sudo bash ~/farm/pi/setup_gateway.sh
```

This installs:
- `chirpstack-concentratord-sx1302` (SPI → ZeroMQ)
- `chirpstack-mqtt-forwarder` (ZeroMQ → MQTT)

Verify:
```bash
sudo systemctl status chirpstack-concentratord
sudo systemctl status chirpstack-mqtt-forwarder
```

### 3. Configure Node-RED

The dashboard and flows are now automatically configured via mounted files. If you need to install packages manually:

```bash
# Install required Node-RED packages (dashboard + postgres)
docker exec farm-nodered npm install node-red-dashboard node-red-contrib-postgresql
docker restart farm-nodered
```

**Note:** With the updated `docker-compose.yml`, `package.json` is mounted and packages should auto-install on first startup. If the dashboard doesn't work, restart the container:

```bash
docker restart farm-nodered
```

**Dashboard Access:** After packages are installed, access the dashboard at:
- `http://<pi>:1880/ui/farm-monitor`

### 4. Verify

- ChirpStack: `http://<pi>:8080` (admin / admin) — gateway should appear
- Node-RED: `http://<pi>:1880` — MQTT nodes should show green "connected"

## Registering Devices

One-time setup, then repeat "Add Device" for each sensor.

### Create Device Profile

ChirpStack → **Device profiles** → Add:

| Setting | Value |
|---------|-------|
| Name | `heltec-otaa` |
| Region | `US915` (or EU868) |
| MAC version | `LoRaWAN 1.0.3` |
| Supports OTAA | ✓ |

Optional — Codec tab decoder:
```javascript
function decodeUplink(input) {
    var str = String.fromCharCode.apply(null, input.bytes);
    var data = {};
    str.split(",").forEach(function(p) {
        var kv = p.split(":");
        if (kv.length === 2) data[kv[0]] = parseFloat(kv[1]) || kv[1];
    });
    return { data: data };
}
```

### Create Application

ChirpStack → **Applications** → Add → Name: `farm-sensors`

### Add Device

For each Heltec sensor:

1. **Applications** → `farm-sensors` → **Add device**
2. Enter: Name, Device EUI (from serial output), select `heltec-otaa` profile
3. Save → **OTAA keys** tab → **Generate**
4. Copy the Application Key → use in Heltec [secrets.h](../heltec/README.md)



## File Structure

```
pi/
├── docker-compose.yml         # Service definitions
├── setup_farm_pi.sh           # Initial Pi setup
├── setup_gateway.sh           # SX1302 HAT installation
├── chirpstack/server/         # ChirpStack + region configs
├── nodered/flows.json         # Node-RED data pipeline
├── mosquitto/mosquitto.conf   # MQTT broker config
└── postgres/init-db.sql       # Database schema
```

## Troubleshooting

### Database Reset

```bash
docker-compose down
sudo rm -rf /srv/farm/postgres
sudo mkdir -p /srv/farm/postgres && sudo chown 70:70 /srv/farm/postgres && sudo chmod 700 /srv/farm/postgres
docker-compose up -d
```
### Register Gateway (after database reset)

If gateway doesn't auto-register:

1. Get gateway EUI:
   ```bash
   sudo journalctl -u chirpstack-mqtt-forwarder | grep gateway_id | tail -1
   ```

2. In ChirpStack: Tenants → Gateways → Add → paste Gateway ID

⚠️ **Deletes all data.** Re-register gateway, profiles, and devices after.

### PostgreSQL Permission Errors

If you see `could not open file "global/pg_filenode.map": Permission denied`:

```bash
# Stop services
docker-compose -f ~/farm/pi/docker-compose.yml stop chirpstack postgres

# Fix ownership and permissions (postgres:15-alpine uses UID 70)
sudo chown -R 70:70 /srv/farm/postgres
sudo chmod 700 /srv/farm/postgres

# Restart services
docker-compose -f ~/farm/pi/docker-compose.yml start postgres
# Wait for PostgreSQL to be healthy (check with: docker ps)
docker-compose -f ~/farm/pi/docker-compose.yml start chirpstack

# Verify
docker logs farm-postgres --tail 20
docker logs farm-chirpstack --tail 20
```

### Check Services

```bash
docker ps                                    # All containers running?
docker logs farm-postgres --tail 50         # PostgreSQL errors?
docker logs farm-chirpstack --tail 50       # ChirpStack errors?
docker logs farm-nodered --tail 50          # Node-RED errors?
sudo journalctl -fu chirpstack-concentratord # Gateway HAT logs
```

### Gateway Issues

| Problem | Solution |
|---------|----------|
| "Failed to set SX1250 in STANDBY_RC mode" | Wrong GPIO pins or HAT not seated |
| Gateway shows "Never seen" | Topic prefix mismatch — check `mqtt-forwarder.toml` |
| SPI not found | `sudo raspi-config` → enable SPI, reboot |

### Test MQTT

```bash
# Watch all device events
docker exec farm-mosquitto mosquitto_sub -t 'application/#' -v

# Watch gateway traffic
docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/#' -v -C 3

# Send test message
docker exec farm-mosquitto mosquitto_pub \
  -t 'application/1/device/test/event/up' \
  -m '{"deviceInfo":{"devEui":"test"},"object":{"temp":25}}'
```

### Service Management

```bash
sudo systemctl restart chirpstack-concentratord chirpstack-mqtt-forwarder
sudo systemctl stop chirpstack-concentratord chirpstack-mqtt-forwarder
```
