# UIBuilder Dashboard Migration Plan

## Overview
This plan details the migration from the existing Node-RED Dashboard (@flowfuse/node-red-dashboard) to uibuilder with Vue 3, ECharts, and DaisyUI.

## Current State Analysis

### Existing Architecture
- **Frontend**: @flowfuse/node-red-dashboard with ui-template nodes
- **Backend**: Node-RED flows with PostgreSQL queries
- **Data Flow**: MQTT → Parse → PostgreSQL → Dashboard flows → UI widgets
- **Features**:
  - Device selection dropdown
  - Real-time sensor data display
  - Historical charts (Battery, Water, RSSI, SNR)
  - Auto-refresh every 30 seconds

### Existing Data Structure
The sensor data from ChirpStack is stored with these fields:
```javascript
{
  deveui: "48ca43fffe3f0e70",
  bp: 85.5,           // Battery percentage
  wl: 67.3,           // Water level percentage
  tv: 245.6,          // Total volume (liters)
  fr: 12.3,           // Flow rate
  tsr: 345678,        // Timestamp/uptime in seconds
  _rssi: -85,         // Signal strength
  _snr: 7.5,          // Signal-to-noise ratio
  _fCnt: 123,         // Frame counter
  _fPort: 1           // Port number
}
```

### Existing Flow Components
Located in `dashboard-flow-nodes.json`:
1. **switch-routes**: Routes incoming messages by topic
2. **pg-get-devices**: Queries distinct devices from database
3. **func-format-devices**: Formats device list for frontend
4. **func-get-current**: Gets latest reading for selected device
5. **func-format-current**: Formats current data with calculated uptime
6. **func-get-history**: Complex SQL query for 24h historical data
7. **func-format-charts**: Formats chart data for frontend
8. **inject-refresh**: Auto-refresh trigger every 30s

## Target State (UIBuilder + Vue + ECharts + DaisyUI)

### Frontend Stack
- **Vue 3**: Reactive UI framework (Options API)
- **ECharts**: Charting library for gauges and line charts
- **DaisyUI**: Tailwind CSS component library for modern UI
- **UIBuilder**: Node-RED module for custom web apps

### Message Protocol
UIBuilder uses a bidirectional message system:

**Frontend → Node-RED:**
```javascript
uibuilder.send({ topic: 'requestDeviceList' })
uibuilder.send({ topic: 'selectDevice', payload: deviceEui })
```

**Node-RED → Frontend:**
```javascript
{ topic: 'deviceList', payload: [{eui, name}, ...] }
{ topic: 'deviceData', payload: {current: {...}} }
{ topic: 'chartData', payload: {battery: [...], water: [...], ...} }
{ topic: 'realtimeUpdate', payload: {...} }
```

## Migration Tasks

### Phase 1: Frontend Setup (Ready from plan.txt)
✅ Files already defined in plan.txt:
- [index.html](dashboard/index.html) - Vue app structure with DaisyUI
- [index.js](dashboard/index.js) - Vue app logic with ECharts integration
- [index.css](dashboard/index.css) - Currently just imports uib-brand.min.css

**Action Items:**
1. Verify ECharts is available in uibuilder vendor folder
2. Update index.html to load from correct CDN/vendor paths
3. Test Vue app initialization standalone

### Phase 2: Backend Flow Integration

#### 2.1 UIBuilder Node Configuration
Current node ID: `b3b0c47e274b2ad3`
- URL: `/dash`
- Already present in flows.json

**Required Changes:**
- Ensure `fwdInMessages: false` (currently set)
- Configure to send messages back through the flow

#### 2.2 Message Router Node
**Current:** `switch-routes` node handles topic routing
**Status:** ✅ Already correctly structured

Routes to implement:
1. `requestDeviceList` → pg-get-devices
2. `selectDevice` → func-get-current + func-get-history

**Action:** Keep existing logic, just verify connections

#### 2.3 Device List Handler
**Current:** `pg-get-devices` → `func-format-devices`

**Issue:** Query uses `data->>'deveui'` but stored data uses `device_eui` column

**Fix Required:**
```sql
-- Current (in dashboard-flow-nodes.json):
SELECT DISTINCT data->>'deveui' as eui FROM readings
WHERE data->>'deveui' IS NOT NULL ORDER BY eui;

-- Should be:
SELECT DISTINCT device_eui as eui FROM readings
WHERE device_eui IS NOT NULL
  AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344')
ORDER BY eui;
```

**Function format is correct:**
```javascript
const devices = msg.payload.map(row => ({
    eui: row.eui,
    name: `Device ${row.eui.substring(0, 8)}...`
}));
return { topic: 'deviceList', payload: devices };
```

#### 2.4 Current Data Handler
**Current:** `func-get-current` → `pg-exec-query` → `func-format-current`

**Issue:** Query format needs adjustment
```javascript
// Current uses data->>'deveui', should use device_eui column
msg.query = `
    SELECT ts, data
    FROM readings
    WHERE device_eui = $1
    ORDER BY ts DESC
    LIMIT 1
`;
msg.params = [deviceEui];
```

**Format function needs update for ECharts:**
The current format is correct but field names need verification:
```javascript
return {
    topic: 'deviceData',
    payload: {
        current: {
            battery: parseFloat(data.bp) || 0,
            rssi: parseFloat(data._rssi) || -120,
            snr: parseFloat(data._snr) || -20,
            waterLevel: parseFloat(data.wl) || 0,
            waterVolume: parseFloat(data.tv) || 0,
            flowRate: parseFloat(data.fr) || 0,
            uptime: uptime
        }
    }
};
```

#### 2.5 Historical Data Handler
**Current:** `func-get-history` → `pg-exec-history` → `func-format-charts`

**Issues:**
1. Query uses `data->>'deveui'` instead of `device_eui`
2. Returns combined JSON, which is good

**Fix Required:**
```javascript
msg.query = `
    WITH battery AS (
        SELECT ts, (data->>'bp')::float as value
        FROM readings
        WHERE device_eui = $1
        AND ts > NOW() - INTERVAL '24 hours'
        AND data->>'bp' IS NOT NULL
        ORDER BY ts
    ),
    water AS (
        SELECT ts, (data->>'tv')::float as value
        FROM readings
        WHERE device_eui = $1
        AND ts > NOW() - INTERVAL '24 hours'
        AND data->>'tv' IS NOT NULL
        ORDER BY ts
    ),
    rssi AS (
        SELECT ts, (data->>'_rssi')::float as value
        FROM readings
        WHERE device_eui = $1
        AND ts > NOW() - INTERVAL '1 hour'
        AND data->>'_rssi' IS NOT NULL
        ORDER BY ts
    ),
    snr AS (
        SELECT ts, (data->>'_snr')::float as value
        FROM readings
        WHERE device_eui = $1
        AND ts > NOW() - INTERVAL '24 hours'
        AND data->>'_snr' IS NOT NULL
        ORDER BY ts
    )
    SELECT
        (SELECT json_agg(row_to_json(battery)) FROM battery) as battery,
        (SELECT json_agg(row_to_json(water)) FROM water) as water,
        (SELECT json_agg(row_to_json(rssi)) FROM rssi) as rssi,
        (SELECT json_agg(row_to_json(snr)) FROM snr) as snr
`;
msg.params = [deviceEui];
```

**Format function is correct:**
```javascript
return {
    topic: 'chartData',
    payload: {
        battery: result.battery || [],
        water: result.water || [],
        rssi: result.rssi || [],
        snr: result.snr || []
    }
};
```

#### 2.6 Real-time Update Handler
**New Feature Needed:**

When new sensor data arrives (from farm-flow-tab), it should:
1. Check if it's for the currently selected device
2. Format it as a real-time update
3. Send to uibuilder

**Flow:**
```
farm-to-dash-link → [link in] → device-filter → format-realtime → uibuilder
```

**Already exists:** `dash-link-in` and `device-filter` nodes

**Needs adding:** `format-realtime` function:
```javascript
// Format real-time sensor update for frontend
const data = msg.sensorData;

return {
    topic: 'realtimeUpdate',
    payload: {
        battery: parseFloat(data.bp) || 0,
        rssi: parseFloat(data._rssi) || -120,
        snr: parseFloat(data._snr) || -20,
        waterLevel: parseFloat(data.wl) || 0,
        waterVolume: parseFloat(data.tv) || 0,
        flowRate: parseFloat(data.fr) || 0,
        uptime: calculateUptime(data.tsr)
    }
};
```

### Phase 3: Flow Wiring

#### Current Flow Structure (dashboard-tab)
```
[uibuilder] ← [func-format-charts] ← [pg-exec-history] ← [func-get-history] ← [switch-routes]
            ← [func-format-current] ← [pg-exec-query] ← [func-get-current] ←┘
            ← [func-format-devices] ← [pg-get-devices] ←┘
            ← [format-realtime] ← [device-filter] ← [dash-link-in]
```

#### Integration Steps
1. Copy all nodes from `dashboard-flow-nodes.json` into main `flows.json`
2. Connect uibuilder output to switch-routes input
3. Connect all formatted outputs back to uibuilder input
4. Add real-time update path from dash-link-in → uibuilder
5. Remove old @flowfuse dashboard nodes

### Phase 4: Configuration Changes

#### Database Schema
**Verify table structure:**
```sql
-- Should have both columns:
device_eui VARCHAR(16)  -- Direct column for fast queries
data JSONB              -- Full payload with all fields
```

#### PostgreSQL Config Node
- ID: `a1b2c3d4e5f6a7b9` (in flows.json)
- Referenced as `pg-farmmon` in dashboard-flow-nodes.json
- **Issue:** Config ID mismatch!

**Fix:** Update all PostgreSQL nodes in dashboard-flow-nodes.json to use `a1b2c3d4e5f6a7b9`

#### UIBuilder Vendor Libraries
Ensure these are installed in uibuilder:
```bash
cd ~/.node-red/uibuilder/dash/
npm install vue@3
npm install echarts
```

Or use CDN in index.html (as shown in plan.txt)

### Phase 5: Data Format Compatibility

#### ECharts Expected Format
```javascript
// Line charts expect: [[timestamp, value], [timestamp, value], ...]
// Our query returns: [{ts: '2024-...', value: 85.5}, ...]
// Conversion happens in Vue app (index.js lines 324-349)
```

**Status:** ✅ Vue app already handles conversion

#### Gauge Expected Format
```javascript
// Gauges expect: {battery: number, rssi: number, snr: number, waterLevel: number}
// Our format returns exactly this
```

**Status:** ✅ Format matches

### Phase 6: Testing Plan

1. **Frontend Standalone Test:**
   - Load /dash in browser
   - Verify Vue app mounts
   - Check console for errors
   - Verify ECharts loads

2. **Backend Message Test:**
   - Use inject node to send `{topic: 'requestDeviceList'}`
   - Verify device list appears in frontend
   - Use inject node to send `{topic: 'selectDevice', payload: 'xxx'}`
   - Verify current data and charts load

3. **Real-time Update Test:**
   - Trigger test uplink in farm-flow-tab
   - Verify data appears in dashboard
   - Check gauge updates
   - Verify chart auto-updates

4. **Auto-refresh Test:**
   - Wait 30 seconds
   - Verify charts refresh automatically

## Summary of Required Changes

### Critical Fixes
1. ✅ PostgreSQL config ID: Change `pg-farmmon` → `a1b2c3d4e5f6a7b9` in all nodes
2. ✅ SQL queries: Change `data->>'deveui'` → `device_eui` column
3. ✅ Add real-time update formatter function
4. ✅ Wire uibuilder bidirectionally with message handlers

### Files to Update
1. **flows.json**:
   - Add dashboard-flow-nodes.json content to dashboard-tab
   - Connect uibuilder node properly
   - Remove old dashboard UI nodes

2. **dashboard/index.html**:
   - Already complete in plan.txt
   - Deploy to `~/.node-red/uibuilder/dash/src/`

3. **dashboard/index.js**:
   - Already complete in plan.txt
   - Deploy to `~/.node-red/uibuilder/dash/src/`

4. **dashboard/index.css**:
   - Currently minimal, could be enhanced
   - Deploy to `~/.node-red/uibuilder/dash/src/`

### Node Changes Summary

| Node | Action | Reason |
|------|--------|--------|
| pg-get-devices | Fix query | Use device_eui column |
| func-get-current | Fix query | Use device_eui column |
| func-get-history | Fix query | Use device_eui column |
| func-format-realtime | Create new | Real-time updates to frontend |
| All PostgreSQL nodes | Update config | Use correct config ID |
| uibuilder | Verify wiring | Bidirectional message flow |

## Next Steps

1. Back up current flows.json
2. Test database schema has device_eui column
3. Copy frontend files to uibuilder directory
4. Update PostgreSQL config IDs
5. Fix SQL queries
6. Add real-time formatter
7. Deploy and test
8. Remove old dashboard nodes once verified

## Risk Assessment

**Low Risk:**
- Frontend is standalone Vue app
- Backend queries are read-only
- Can run both dashboards in parallel during migration

**Medium Risk:**
- PostgreSQL config ID change affects all queries
- SQL query changes could break if schema is different

**Mitigation:**
- Test queries in PostgreSQL directly first
- Keep old dashboard nodes disabled but present
- Verify data structure before deployment
