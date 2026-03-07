# Farm Monitor Dashboard - Deployment Guide

## Single Source of Truth
**[flows.json](nodered/flows.json)** - Complete Node-RED configuration

## Quick Deploy

### 1. Install Required Modules (One Time)

Via Node-RED UI:
1. Open `http://your-pi-ip:1880`
2. Menu (≡) → **Manage palette** → **Install** tab
3. Install:
   - `@flowfuse/node-red-dashboard`
   - `node-red-contrib-postgresql`

### 2. Deploy Flows

```bash
sudo cp flows.json /srv/farm/nodered/flows.json
sudo chown 1000:1000 /srv/farm/nodered/flows.json
docker restart farm-nodered
```

### 3. Access Dashboard

`http://your-pi-ip:1880/dashboard`

## Features

### Real-Time Monitoring
- Battery gauge (%, color-coded: red/yellow/green)
- RSSI signal strength (-120 to -30 dBm)
- SNR signal quality (-20 to 20 dB)
- Water tank level (%, tank visualization)
- Device name, uptime, volume, flow rate

### Historical Charts (100 points = ~1.7 hours @ 60s)
- Battery percentage
- RSSI trend
- SNR trend
- Combined RSSI+SNR
- Water flow accumulation

## Configuration

### PostgreSQL (Pre-configured)
Already set to connect to:
- Host: `postgres`, Port: `5432`
- Database: `farmmon`, User: `farmmon`, Password: `farmmon`

### Water Tank Calibration

In Node-RED editor:
1. **Configuration** tab → "Setup Water Tank Config" node
2. Edit parameters:
   ```javascript
   tank: {
       height_cm: 200,          // Your tank height
       capacity_liters: 5000,   // Your tank capacity
   },
   sensor: {
       mounting_height_cm: 210, // Sensor mounting height from ground
       offset_cm: 0,            // Calibration offset (adjust after testing)
   }
   ```
3. **Deploy**

### Adjust Chart History

Edit any chart node → Change `removeOlder`:
- 100 points @ 60s = 1.7 hours
- 360 points @ 60s = 6 hours
- 720 points @ 60s = 12 hours
- 1440 points @ 60s = 24 hours

## Architecture

```
LoRaWAN Sensor (60s interval)
    ↓
ChirpStack → MQTT → Node-RED
    ↓
Parse Uplink → Extract Sensor Data (11 outputs)
    ↓
    ├─→ 4 Gauges (Battery, RSSI, SNR, Water)
    ├─→ 4 Text displays (Device, Uptime, Volume, Flow)
    ├─→ 5 Charts (Battery, RSSI, SNR, Signal, Water)
    └─→ Water Processor (level & flow calculations)
```

## Data Flow

**Real-Time**: Sensor data → PostgreSQL → Gauges/Charts (immediate)
**Charts**: Store last N points in memory (no DB queries)
**Water**: Distance sensor → water level calculation, flow rate derivation

## Verification

After deployment, check:
- ✅ Dashboard loads at `/dashboard` path
- ✅ All 4 gauge widgets visible
- ✅ All 5 chart widgets visible
- ✅ Device name shows (not "unknown")
- ✅ Gauges update when sensor sends data (~60s)
- ✅ Charts accumulate data points

## Troubleshooting

**No data showing:**
```bash
docker logs farm-nodered --tail 50
docker exec farm-postgres psql -U farmmon -d farmmon -c "SELECT COUNT(*) FROM readings;"
```

**"Missing node types" error:**
Install modules via UI (step 1)

**Charts not updating:**
- Verify sensor is sending data (check gauges)
- Add debug node to see data flow
- Verify "Extract Sensor Data" has 11 outputs

**Water level incorrect:**
Calibrate `sensor.offset_cm` in Configuration tab

**Permission denied copying flows:**
```bash
sudo chown 1000:1000 /srv/farm/nodered/flows.json
```

## Backup

```bash
# Flows backup
cp /srv/farm/nodered/flows.json ~/flows_backup_$(date +%Y%m%d).json

# Database backup
docker exec farm-postgres pg_dump -U farmmon farmmon > ~/farmmon_$(date +%Y%m%d).sql
```

## Updates

To update flows in the future:
1. Edit `flows.json` locally
2. Test changes
3. Copy to Pi: `scp flows.json pi@your-pi:/srv/farm/nodered/`
4. Restart: `docker restart farm-nodered`

## Components Summary

**Included in flows.json:**
- 4 Tabs (Farm Monitor, Dashboard, API, Configuration)
- 8 Functions (data extraction, water calculations)
- 4 Gauges (battery, RSSI, SNR, water)
- 5 Charts (battery, RSSI, SNR, combined signal, water flow)
- 4 Text displays (device, uptime, volume, flow rate)
- 2 PostgreSQL nodes (store readings, query data)
- Water tank configuration system
- Per-device state tracking

## Additional Resources

- **[WATER_MONITORING.md](../docs/WATER_MONITORING.md)** - Water system architecture details
- **Node-RED Docs**: https://nodered.org/docs/
- **Dashboard 2.0 Docs**: https://dashboard.flowfuse.com/

---

**Total deployment time: < 5 minutes**
