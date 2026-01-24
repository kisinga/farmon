# UIBuilder Dashboard Implementation - COMPLETE

## Summary
The UIBuilder dashboard has been fully implemented and integrated with your existing Node-RED flows.

## Changes Made

### 1. Backend Flow Updates (flows.json)

#### ✅ PostgreSQL Configuration
- **Fixed all PostgreSQL nodes** to use correct config ID: `a1b2c3d4e5f6a7b9`
- **8 PostgreSQL nodes** validated and corrected:
  - Get Device List
  - Get Devices
  - Execute Query
  - Execute History Query
  - Query Battery History
  - Query RSSI History
  - Query SNR History
  - Query Water History

#### ✅ SQL Query Updates
Updated all queries to use `device_eui` column instead of `data->>'deveui'` for better performance:

**pg-get-devices:**
```sql
SELECT DISTINCT device_eui as eui
FROM readings
WHERE device_eui IS NOT NULL
  AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344')
ORDER BY eui
```

**func-get-current:**
```sql
SELECT ts, data
FROM readings
WHERE device_eui = $1
ORDER BY ts DESC
LIMIT 1
```

**func-get-history:**
```sql
WITH battery AS (
    SELECT ts, (data->>'bp')::float as value
    FROM readings
    WHERE device_eui = $1
    AND ts > NOW() - INTERVAL '24 hours'
    AND data->>'bp' IS NOT NULL
    ORDER BY ts
),
water AS (...),
rssi AS (...),
snr AS (...)
SELECT ...
```

#### ✅ New Nodes Added

**func-format-realtime:**
- Formats real-time sensor updates for frontend
- Calculates uptime from `tsr` field
- Sends `realtimeUpdate` topic to uibuilder
- Positioned at: x=570, y=320

#### ✅ Node Wiring Updated

**device-filter:**
- Now wires to: `func-format-realtime` AND `dash1`

**uibuilder (b3b0c47e274b2ad3):**
- **Input:** Receives from:
  - func-format-devices
  - func-format-current
  - func-format-charts
  - func-format-realtime
- **Output:** Sends to:
  - switch-routes
- **Position:** x=1500, y=740

**switch-routes:**
- **Input:** From uibuilder
- **Outputs:**
  1. requestDeviceList → pg-get-devices
  2. selectDevice → func-get-current + func-get-history

### 2. Frontend Deployment

#### ✅ Files Created in ~/.node-red/uibuilder/dash/src/

**index.html** (6.1 KB)
- Vue 3 application structure
- DaisyUI components for modern UI
- ECharts containers for gauges and line charts
- Responsive grid layout
- Device selector and stats cards

**index.js** (8.8 KB)
- Vue app with Options API
- UIBuilder integration
- Message handling for 4 topics:
  - `deviceList` - Device dropdown
  - `deviceData` - Current sensor values
  - `chartData` - Historical data
  - `realtimeUpdate` - Live updates
- ECharts gauge configurations
- ECharts line chart configurations
- Auto-resize handlers

**index.css** (239 bytes)
- Imports uibuilder brand CSS
- Minimal custom styling

### 3. Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    DASHBOARD DATA FLOW                   │
└─────────────────────────────────────────────────────────┘

┌─── FARM FLOW TAB ────────────────────────────────────────┐
│  MQTT → Parse Uplink → Store DB → farm-to-dash-link     │
└──────────────────────────────┬───────────────────────────┘
                               │
┌─── DASHBOARD TAB ────────────▼───────────────────────────┐
│  dash-link-in → device-filter → func-format-realtime     │
│                                        │                  │
│                                        ▼                  │
│  ┌─────────────────────────────────────────┐            │
│  │           UIBUILDER NODE                │            │
│  │  (b3b0c47e274b2ad3)                    │            │
│  ├─────────────────────────────────────────┤            │
│  │  Inputs:                                │            │
│  │  • func-format-devices                  │            │
│  │  • func-format-current                  │            │
│  │  • func-format-charts                   │            │
│  │  • func-format-realtime                 │            │
│  │                                         │            │
│  │  Output:                                │            │
│  │  • switch-routes                        │            │
│  └─────────────────────────────────────────┘            │
│                    │                                      │
│                    ▼                                      │
│            switch-routes                                  │
│         ┌──────────┴──────────┐                          │
│         │                     │                          │
│  requestDeviceList     selectDevice                      │
│         │                     │                          │
│         ▼                     ├─────────┬────────┐       │
│  pg-get-devices              │         │        │       │
│         │                    ▼         ▼        │       │
│         ▼           func-get-current  func-get-history  │
│  func-format-devices        │              │            │
│         │                   ▼              ▼            │
│         └────────────► pg-exec-query  pg-exec-history   │
│                             │              │            │
│                             ▼              ▼            │
│                     func-format-current  func-format-   │
│                             │             charts        │
│                             └─────┬────────┘            │
│                                   │                     │
│                                   └─► UIBUILDER ◄───────┘
└─────────────────────────────────────────────────────────┘
```

## Files Modified/Created

### Modified
- [flows.json](../flows.json) - Integrated dashboard nodes, fixed configs, updated queries
- [flows.json.backup](../flows.json.backup) - Original backup created

### Created
- [~/.node-red/uibuilder/dash/src/index.html](~/.node-red/uibuilder/dash/src/index.html)
- [~/.node-red/uibuilder/dash/src/index.js](~/.node-red/uibuilder/dash/src/index.js)
- [~/.node-red/uibuilder/dash/src/index.css](~/.node-red/uibuilder/dash/src/index.css)

## Testing Instructions

### 1. Restart Node-RED
```bash
# If using systemd
sudo systemctl restart nodered

# If using pm2
pm2 restart node-red

# If running manually
# Stop with Ctrl+C and restart
node-red
```

### 2. Access the Dashboard
Open your browser and navigate to:
```
http://your-node-red-server:1880/dash
```

### 3. Check Node-RED Debug Panel
1. Open Node-RED editor: `http://your-node-red-server:1880`
2. Open the Debug panel (bug icon on right sidebar)
3. Watch for messages as the dashboard loads

### 4. Test Device List
- The device list should populate automatically when the page loads
- Check debug panel for `deviceList` topic messages
- If empty, verify database has data:
  ```sql
  SELECT COUNT(*) FROM readings;
  SELECT DISTINCT device_eui FROM readings LIMIT 5;
  ```

### 5. Test Device Selection
1. Select a device from the dropdown
2. Loading spinner should appear briefly
3. Current stats should update:
   - Battery percentage
   - Water level
   - Uptime
4. Gauges should animate to current values
5. Charts should populate with 24h history

### 6. Test Real-time Updates
1. Trigger a test uplink in Farm Flow tab:
   - Click "Test Uplink" inject node
   - Or wait for real device uplink
2. If device matches selected device:
   - Gauges should update
   - Current stats should refresh
   - Charts should add new point

### 7. Browser Console Check
Open browser console (F12) and check for:
- ✅ "Received:" messages showing incoming data
- ✅ No JavaScript errors
- ✅ ECharts loaded successfully
- ✅ Vue app mounted

## Expected Behavior

### On Page Load
1. ✅ Shows "Disconnected" badge initially
2. ✅ Connects to uibuilder (badge turns green "Connected")
3. ✅ Requests device list automatically
4. ✅ Populates device dropdown

### On Device Selection
1. ✅ Shows loading spinner
2. ✅ Fetches current data
3. ✅ Fetches 24h history
4. ✅ Updates all gauges
5. ✅ Updates all charts
6. ✅ Displays device stats

### On Real-time Update
1. ✅ Gauges animate to new values
2. ✅ Stats cards update
3. ✅ Charts add new data point (if auto-refresh enabled)

## Troubleshooting

### Issue: Device list not loading
**Check:**
```bash
# In PostgreSQL
SELECT DISTINCT device_eui FROM readings WHERE device_eui IS NOT NULL LIMIT 10;
```
**Fix:** Ensure database has data with device_eui column populated

### Issue: Charts not displaying
**Check:**
- Browser console for ECharts errors
- Verify data format: `{ts: timestamp, value: number}`
- Check chart container has height: `.chart-container { height: 300px; }`

### Issue: Real-time updates not working
**Check:**
- Link nodes connected: `farm-to-dash-link` → `dash-link-in`
- Device filter allows selected device
- `func-format-realtime` wired to uibuilder
- Debug node after `func-format-realtime` shows messages

### Issue: PostgreSQL errors
**Check:**
- All nodes use config: `a1b2c3d4e5f6a7b9`
- Database connection working
- Table `readings` exists
- Column `device_eui` exists

### Issue: Gauges not displaying
**Check:**
- ECharts loaded: browser console `typeof echarts`
- Gauge containers have height: `.gauge-container { height: 200px; }`
- Vue refs working: check browser console errors

## Performance Notes

### Database Indexes
For better performance, create indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_readings_device_eui ON readings(device_eui);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_eui, ts);
```

### Query Optimization
- 24h queries are optimized with intervals
- RSSI uses 1h interval (frequent updates)
- Device list excludes test devices

### Auto-Refresh
- Currently disabled (inject node exists but can be enabled)
- Set to 30s interval if needed
- Charts will update automatically

## Next Steps

### Optional Enhancements
1. Enable auto-refresh inject node for automatic chart updates
2. Add authentication to dashboard
3. Add alert notifications
4. Implement data export functionality
5. Add device configuration UI
6. Create mobile-optimized layout

### Monitoring
1. Watch Node-RED logs for errors
2. Monitor PostgreSQL query performance
3. Check browser console for client-side errors
4. Monitor memory usage (ECharts can be memory-intensive)

## Validation Results

✅ **68 total nodes** in flows.json
✅ **34 nodes** in dashboard-tab
✅ **All critical nodes** present and wired
✅ **All PostgreSQL configs** corrected
✅ **All SQL queries** updated
✅ **Frontend files** deployed
✅ **Real-time updates** configured
✅ **Message routing** configured

## Support

If you encounter issues:

1. Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for common patterns
2. Review [FLOW_SNIPPETS.md](FLOW_SNIPPETS.md) for code examples
3. See [MIGRATION_PLAN.md](MIGRATION_PLAN.md) for architecture details
4. Enable debug nodes in dashboard-tab and watch debug panel
5. Check browser console for frontend errors

## Rollback

If needed, restore the backup:
```bash
cp flows.json.backup flows.json
# Restart Node-RED
sudo systemctl restart nodered
```

---

**Implementation Date:** 2026-01-23
**Status:** ✅ COMPLETE - Ready for testing
**Dashboard URL:** http://localhost:1880/dash
