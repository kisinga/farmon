# UIBuilder Dashboard Quick Reference

For the standard message and DB contract (device context, params, request/response shapes, telemetry row, history), see [docs/DATA_CONTRACT.md](../docs/DATA_CONTRACT.md).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FARM MONITOR                             │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  ChirpStack  │ MQTT │   Node-RED   │ HTTP │   Browser    │
│   Gateway    │─────▶│  Farm Flow   │◀────▶│ Vue+ECharts  │
└──────────────┘      └──────┬───────┘      └──────────────┘
                             │
                      ┌──────▼───────┐
                      │  PostgreSQL  │
                      │   Database   │
                      └──────────────┘

                   Data Flow Architecture
```

## Message Flow

### Uplink Flow (ChirpStack → Database → Dashboard)
```
MQTT Topic: application/+/device/+/event/up
    ↓
Parse Uplink (extract deviceEui, sensorData, rssi, snr)
    ↓
Store in PostgreSQL (device_eui, data jsonb)
    ↓
Link to Dashboard Tab
    ↓
Filter by Selected Device
    ↓
Format Real-time Update
    ↓
UIBuilder → Vue App (update gauges)
```

### Dashboard Query Flow (User Action → Data Display)
```
User Action (select device)
    ↓
Vue App: uibuilder.send({ topic: 'selectDevice', payload: eui })
    ↓
UIBuilder Node → Switch Router
    ↓
┌─────────────────┬───────────────────┐
│ Get Current     │ Get History       │
│   ↓             │   ↓               │
│ Query Latest    │ Query 24h Data    │
│   ↓             │   ↓               │
│ Format Current  │ Format Charts     │
└─────────────────┴───────────────────┘
    ↓
UIBuilder ← Vue App (render UI)
```

## Data Structure Reference

### Database Schema
```sql
CREATE TABLE readings (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMP DEFAULT NOW(),
    device_eui VARCHAR(16) NOT NULL,
    data JSONB NOT NULL
);

-- Recommended indexes
CREATE INDEX idx_readings_device_eui ON readings(device_eui);
CREATE INDEX idx_readings_ts ON readings(ts);
CREATE INDEX idx_readings_device_ts ON readings(device_eui, ts);
```

### JSONB Data Fields
```javascript
{
  deveui: "48ca43fffe3f0e70",  // Device EUI (duplicated in column)
  bp: 85.5,                     // Battery Percentage (0-100)
  wl: 67.3,                     // Water Level percentage (0-100)
  tv: 245.6,                    // Total Volume in liters
  fr: 12.3,                     // Flow Rate (L/min or L/h)
  tsr: 345678,                  // Time Since Reset (seconds)
  _rssi: -85,                   // Received Signal Strength (-120 to 0 dBm)
  _snr: 7.5,                    // Signal-to-Noise Ratio (-20 to 10 dB)
  _fCnt: 123,                   // Frame Counter
  _fPort: 1                     // LoRaWAN Port
}
```

## UIBuilder Message Protocol

### Messages from Frontend → Node-RED

#### Request Device List
```javascript
uibuilder.send({
    topic: 'requestDeviceList'
});
```

#### Select Device
```javascript
uibuilder.send({
    topic: 'selectDevice',
    payload: '48ca43fffe3f0e70'  // Device EUI
});
```

#### System commands (sendCommand)
Frontend sends `{ topic: 'sendCommand', payload: { eui, command, value? } }`. Node-RED builds ChirpStack downlink; firmware applies by fPort. All commands validated against `heltec/lib/protocol_constants.h` and `heltec/remote_app.cpp` `onDownlinkReceived`.

| Command        | fPort | Payload (downlink) | Firmware behavior |
|----------------|-------|--------------------|--------------------|
| `reset`        | 10    | 1 byte `0x01`      | Reset water volume, error count, counters; persist. |
| `setInterval`  | 11    | 4 bytes big-endian **milliseconds** (10_000–3_600_000) | `scheduler.setTaskInterval("lorawan_tx", ms)`; valid range 10s–3600s. |
| `reboot`       | 12    | 1 byte `0x01`      | Send ACK then `ESP.restart()`. |
| `clearErrors`  | 13    | 1 byte `0x01`      | Clear error count; persist. |
| `forceReg`     | 14    | 1 byte `0x01`      | Clear NVS reg state; device re-registers. |
| `requestStatus`| 15    | 1 byte `0x01`      | Send diagnostics uplink on fPort 6. |

Example (setInterval 10 seconds):
```javascript
uibuilder.send({
    topic: 'sendCommand',
    payload: { eui: '48ca43fffe3e8ee4', command: 'setInterval', value: 10 }
});
```
Node-RED encodes `value` (seconds) as 4-byte interval in ms (clamped 10–3600s) so the device actually changes the TX interval.

### Messages from Node-RED → Frontend

#### Device List Response
```javascript
{
    topic: 'deviceList',
    payload: [
        { eui: '48ca43fffe3f0e70', name: 'Device 48ca43ff...' },
        { eui: 'aabbccddeeff1122', name: 'Device aabbccdd...' }
    ]
}
```

#### Current Device Data
```javascript
{
    topic: 'deviceData',
    payload: {
        current: {
            battery: 85.5,
            rssi: -85,
            snr: 7.5,
            waterLevel: 67.3,
            waterVolume: 245.6,
            flowRate: 12.3,
            uptime: '4d 3h 45m'
        }
    }
}
```

#### Historical Chart Data
```javascript
{
    topic: 'chartData',
    payload: {
        battery: [
            { ts: '2024-01-20T10:00:00Z', value: 85.5 },
            { ts: '2024-01-20T11:00:00Z', value: 84.2 }
        ],
        water: [...],
        rssi: [...],
        snr: [...]
    }
}
```

#### Real-time Update
```javascript
{
    topic: 'realtimeUpdate',
    payload: {
        battery: 85.5,
        rssi: -85,
        snr: 7.5,
        waterLevel: 67.3,
        waterVolume: 245.6,
        flowRate: 12.3,
        uptime: '4d 3h 45m'
    }
}
```

## Node-RED Function Nodes

### Parse Uplink (Farm Flow Tab)
**Purpose:** Extract device info and sensor data from ChirpStack MQTT message

**Input:** ChirpStack v4 uplink event
**Output:**
- `msg.deviceEui`: Device EUI string
- `msg.sensorData`: Decoded sensor data object
- `msg.params`: [deviceEui, jsonData] for PostgreSQL

### Switch Router (Dashboard Tab)
**Purpose:** Route incoming messages to appropriate handlers

**Routes:**
- `requestDeviceList` → Get Devices Query
- `selectDevice` → Get Current + Get History

### Get Current Data (Dashboard Tab)
**Purpose:** Fetch latest reading for selected device

**SQL:**
```sql
SELECT ts, data
FROM readings
WHERE device_eui = $1
ORDER BY ts DESC
LIMIT 1
```

### Format Current Data (Dashboard Tab)
**Purpose:** Convert database row to frontend format

**Key Logic:**
- Parse JSONB fields to numbers
- Calculate uptime from `tsr` field
- Handle missing values with defaults

### Get History (Dashboard Tab)
**Purpose:** Fetch 24-hour historical data for all metrics

**SQL:** Uses CTEs to query battery, water, RSSI, SNR separately, then combines with `json_agg`

### Format Chart Data (Dashboard Tab)
**Purpose:** Package historical data for ECharts

**Output:** Arrays of `{ts, value}` objects per metric

### Format Real-time Update (Dashboard Tab)
**Purpose:** Convert live sensor data to frontend format

**Trigger:** New uplink from currently selected device

## Vue App Structure

### Main Components

```javascript
createApp({
    data() {
        return {
            connected: false,      // UIBuilder connection status
            loading: false,        // Loading indicator
            devices: [],           // Available devices
            selectedDevice: '',    // Currently selected device EUI
            current: {...},        // Current sensor values
            charts: {},            // ECharts chart instances
            gauges: {}            // ECharts gauge instances
        }
    },

    methods: {
        initUIBuilder()        // Set up message handlers
        handleMessage()        // Route incoming messages
        initCharts()          // Create chart instances
        initGauges()          // Create gauge instances
        updateCharts()        // Update chart data
        updateGauges()        // Update gauge data
    }
})
```

### Key Lifecycle Events

1. **mounted()**: Initialize UIBuilder, create charts/gauges
2. **onChange('connected')**: Request device list when connected
3. **onChange('msg')**: Handle incoming data messages
4. **@change (device select)**: Request data for new device

## ECharts Configuration

### Line Chart (Historical Data)
```javascript
{
    xAxis: { type: 'time' },
    yAxis: { type: 'value' },
    series: [{
        type: 'line',
        data: [[timestamp, value], ...],  // Time-series data
        smooth: true,
        areaStyle: { ... }
    }]
}
```

### Gauge (Real-time Value)
```javascript
{
    series: [{
        type: 'gauge',
        min: minValue,
        max: maxValue,
        axisLine: {
            lineStyle: {
                color: [[0.2, 'red'], [0.5, 'yellow'], [1, 'green']]
            }
        },
        data: [{ value: currentValue }]
    }]
}
```

## URL Structure

| URL | Purpose |
|-----|---------|
| `/dash` | Main dashboard UI (uibuilder) |
| `/admin` | Node-RED flow editor |
| `/dashboard` | Old dashboard (if still present) |

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| flows.json | `~/.node-red/` | Node-RED flow configuration |
| index.html | `~/.node-red/uibuilder/dash/src/` | Vue app HTML |
| index.js | `~/.node-red/uibuilder/dash/src/` | Vue app logic |
| index.css | `~/.node-red/uibuilder/dash/src/` | Custom styles |

## Common Issues & Solutions

### Issue: Device list not loading
**Check:**
- PostgreSQL connection (check config node)
- Database has data: `SELECT COUNT(*) FROM readings;`
- Query returns results: `SELECT DISTINCT device_eui FROM readings LIMIT 5;`
- Browser console for errors

### Issue: Charts not displaying
**Check:**
- ECharts loaded (browser console: `typeof echarts`)
- Chart container has height (CSS: `.chart-container { height: 300px; }`)
- Data format is correct: `[[timestamp, value], ...]`
- No errors in Vue app console

### Issue: Real-time updates not working
**Check:**
- Link nodes connected: `farm-to-dash-link` → `dash-link-in`
- Device filter allows selected device
- Format-realtime function creates correct message
- UIBuilder receives message (check debug node)

### Issue: PostgreSQL queries failing
**Check:**
- Config ID matches: `a1b2c3d4e5f6a7b9`
- Database credentials correct
- Table name is `readings`
- JSONB operators work: `data->>'bp'`

## Performance Tips

1. **Database Indexing:**
   ```sql
   CREATE INDEX idx_readings_device_ts ON readings(device_eui, ts);
   ```

2. **Query Optimization:**
   - Use `LIMIT` on large result sets
   - Filter by time range to reduce data
   - Use `EXPLAIN ANALYZE` to check query plans

3. **Frontend:**
   - Debounce auto-refresh if needed
   - Use ECharts `notMerge: false` for updates
   - Dispose unused chart instances

4. **Node-RED:**
   - Don't log excessively in production
   - Use flow variables for state
   - Avoid large payloads in messages

## Debugging Commands

### PostgreSQL
```sql
-- Check device count
SELECT COUNT(DISTINCT device_eui) FROM readings;

-- Recent readings
SELECT device_eui, ts, data->>'bp' as battery
FROM readings
ORDER BY ts DESC
LIMIT 10;

-- Check for missing fields
SELECT device_eui, COUNT(*)
FROM readings
WHERE data->>'bp' IS NULL
GROUP BY device_eui;
```

### Node-RED
```javascript
// In function node, log message structure
node.warn(JSON.stringify(msg, null, 2));

// Check flow variable
const selected = flow.get('selectedDevice');
node.warn(`Selected: ${selected}`);
```

### Browser Console
```javascript
// Check Vue app data
document.getElementById('app').__vue_app__.config.globalProperties.$data

// Check UIBuilder connection
uibuilder.get('isConnected')

// Send test message
uibuilder.send({ topic: 'requestDeviceList' })
```

## Next Steps After Deployment

1. Monitor performance for 24 hours
2. Add error handling for edge cases
3. Implement data retention policy
4. Add more visualizations as needed
5. Create user documentation
6. Set up automated backups
7. Add authentication if needed
8. Consider adding alerts/notifications
