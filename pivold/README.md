# Farmon Gateway (Raspberry Pi)

ChirpStack + Node-RED + PostgreSQL on Raspberry Pi with SX1302 LoRaWAN HAT.

## Setup

### Initial Setup

```bash
# Fresh Pi - run as regular user (not root)
curl -sSL https://github.com/kisinga/farmon/raw/main/pi/setup_farm_pi.sh | bash
```

Installs Docker, clones repo, starts all services.

### Deployment & Updates

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `deploy.sh` | Full deployment: git pull → stop → sync → start | After pushing changes to git |
| `sync_config.sh` | Sync config files without git pull | Testing local changes |

**Typical workflow:**
```bash
# On your development machine
git add . && git commit -m "update" && git push

# On the Pi
cd ~/farm/pi
bash deploy.sh
```

**Quick config sync (no git pull):**
```bash
cd ~/farm/pi
bash sync_config.sh          # sync changed files only
bash sync_config.sh --force  # force sync all files
```

### Gateway Setup

Enable SPI: `sudo raspi-config` → Interface Options → SPI

```bash
sudo bash ~/farm/pi/setup_gateway.sh
```

Installs concentratord (SPI → ZeroMQ) and MQTT forwarder (ZeroMQ → MQTT).

**Verify:**
```bash
sudo systemctl status chirpstack-concentratord chirpstack-mqtt-forwarder
```

### Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| ChirpStack | `http://<pi>:8080` | admin / admin |
| Node-RED | `http://<pi>:1880` | admin / farmmon |
| Dashboard | `http://<pi>:1880/dashboard/farm-monitor` | - |

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



## Scripts

| Script | Purpose |
|--------|---------|
| `setup_farm_pi.sh` | Initial setup: install Docker, clone repo, start services |
| `setup_gateway.sh` | Install LoRaWAN gateway HAT drivers (run with sudo) |
| `deploy.sh` | Deploy updates: git pull → stop → sync → start |
| `sync_config.sh` | Sync config files to running services |

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
