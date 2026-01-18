# Farmon Gateway (Raspberry Pi)

ChirpStack + Node-RED + PostgreSQL on Raspberry Pi.

## Services

| Service | Port | Default Login |
|---------|------|---------------|
| ChirpStack | 8080 | admin / admin |
| Node-RED | 1880 | — |
| Mosquitto | 1883 | — |
| PostgreSQL | 5432 | farmmon / farmmon |

## Setup

### 1. Initial Setup

```bash
# Fresh Pi - run as regular user (not root)
curl -sSL https://github.com/kisinga/farmon/raw/main/edge/pi/setup_farm_pi.sh | bash
```

Or manually:
```bash
git clone https://github.com/kisinga/farmon.git ~/farm
cd ~/farm/edge/pi
sudo bash setup_farm_pi.sh
```

### 2. Start Services

```bash
cd ~/farm/edge/pi
docker-compose up -d
```

### 3. Install Gateway HAT

See [GATEWAY_SETUP.md](GATEWAY_SETUP.md) for SX1302 hardware installation.

### 4. Configure Node-RED

```bash
docker exec farm-nodered npm install node-red-contrib-postgresql
docker cp nodered/flows.json farm-nodered:/data/flows.json
docker restart farm-nodered
```

## Registering Devices

### Create Device Profile (once)

1. ChirpStack (`http://<pi>:8080`) → **Device profiles** → Add
2. Configure:
   - Name: `heltec-otaa`
   - Region: `US915` (match your gateway)
   - MAC version: `LoRaWAN 1.0.3`
   - Supports OTAA: ✓
3. Codec tab — add decoder (optional):
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

### Create Application (once)

1. **Tenants** → **Applications** → Add
2. Name: `farm-sensors`

### Register Each Device

1. **Applications** → `farm-sensors` → Add device
2. Configure:
   - Name: Device identifier (e.g., `remote-01`)
   - Device EUI: From Heltec serial output at boot
   - Device profile: `heltec-otaa`
3. After saving → **OTAA keys** tab → Generate
4. Copy Application Key → paste into Heltec `secrets.h`

## File Structure

```
edge/pi/
├── docker-compose.yml        # Service definitions
├── setup_farm_pi.sh          # Initial Pi setup
├── setup_gateway.sh          # SX1302 HAT installation
├── GATEWAY_SETUP.md          # Gateway hardware docs
├── chirpstack/server/        # ChirpStack + region configs
├── nodered/flows.json        # Node-RED data pipeline
├── mosquitto/mosquitto.conf  # MQTT broker config
└── postgres/init-db.sql      # Database schema
```

## Troubleshooting

### Database Reset

```bash
docker-compose down
sudo rm -rf /srv/farm/postgres
sudo mkdir -p /srv/farm/postgres && sudo chown 999:999 /srv/farm/postgres
docker-compose up -d
```

⚠️ **Deletes all data.** Re-register gateway, profiles, and devices after.

### Check Services

```bash
docker ps                                    # All containers running?
docker logs farm-chirpstack --tail 50       # ChirpStack errors?
docker logs farm-nodered --tail 50          # Node-RED errors?
```

### Test MQTT

```bash
# Watch all device events
docker exec farm-mosquitto mosquitto_sub -t 'application/#' -v

# Send test message
docker exec farm-mosquitto mosquitto_pub \
  -t 'application/1/device/test/event/up' \
  -m '{"deviceInfo":{"devEui":"test"},"object":{"temp":25}}'
```
