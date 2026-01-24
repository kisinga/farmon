# UIBuilder Dashboard Implementation Checklist

## Pre-Implementation

- [ ] Backup current flows.json
  ```bash
  cp flows.json flows.json.backup
  ```

- [ ] Verify database schema
  ```sql
  \d readings
  -- Confirm device_eui column exists
  -- Confirm data jsonb column exists
  ```

- [ ] Test database query compatibility
  ```sql
  -- Test device list query
  SELECT DISTINCT device_eui as eui FROM readings
  WHERE device_eui IS NOT NULL
    AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344')
  ORDER BY eui LIMIT 5;

  -- Test current data query
  SELECT ts, data FROM readings
  WHERE device_eui = '48ca43fffe3f0e70'
  ORDER BY ts DESC LIMIT 1;
  ```

## Frontend Deployment

- [ ] Create/verify uibuilder directory structure
  ```bash
  mkdir -p ~/.node-red/uibuilder/dash/src/
  ```

- [ ] Deploy index.html
  ```bash
  cp dashboard/plan.txt ~/.node-red/uibuilder/dash/src/
  # Extract index.html section (lines 6-151) to index.html
  ```

- [ ] Deploy index.js
  ```bash
  # Extract index.js section (lines 165-437) to index.js
  ```

- [ ] Deploy index.css
  ```bash
  cp dashboard/index.css ~/.node-red/uibuilder/dash/src/
  ```

- [ ] Verify CDN dependencies or install locally
  ```bash
  # Option A: Use CDN (as in plan.txt) - no action needed
  # Option B: Install locally
  cd ~/.node-red/uibuilder/dash/
  npm install vue@3 echarts
  ```

## Backend Flow Updates

### Step 1: PostgreSQL Config ID Fix

- [ ] Open dashboard-flow-nodes.json
- [ ] Find all nodes with `"postgreSQLConfig": "pg-farmmon"`
- [ ] Replace with `"postgreSQLConfig": "a1b2c3d4e5f6a7b9"`
- [ ] Affected nodes:
  - pg-get-devices
  - pg-exec-query
  - pg-exec-history

### Step 2: Fix SQL Queries

- [ ] Update pg-get-devices query
  ```javascript
  "query": "SELECT DISTINCT device_eui as eui FROM readings WHERE device_eui IS NOT NULL AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344') ORDER BY eui"
  ```

- [ ] Update func-get-current query
  ```javascript
  msg.query = `
      SELECT ts, data
      FROM readings
      WHERE device_eui = $1
      ORDER BY ts DESC
      LIMIT 1
  `;
  msg.params = [deviceEui];
  ```

- [ ] Update func-get-history query
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

### Step 3: Add Real-time Update Handler

- [ ] Create new function node: `func-format-realtime`
  ```javascript
  // Format real-time sensor update for frontend
  const data = msg.sensorData;

  // Calculate uptime
  let uptime = '--';
  if (data.tsr) {
      const seconds = parseInt(data.tsr);
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      uptime = `${days}d ${hours}h ${mins}m`;
  }

  return {
      topic: 'realtimeUpdate',
      payload: {
          battery: parseFloat(data.bp) || 0,
          rssi: parseFloat(data._rssi) || -120,
          snr: parseFloat(data._snr) || -20,
          waterLevel: parseFloat(data.wl) || 0,
          waterVolume: parseFloat(data.tv) || 0,
          flowRate: parseFloat(data.fr) || 0,
          uptime: uptime
      }
  };
  ```

- [ ] Position in flow: `device-filter` → `func-format-realtime` → `uibuilder`

### Step 4: Update UIBuilder Node Connections

- [ ] Verify uibuilder node config (ID: b3b0c47e274b2ad3)
  - URL: `dash`
  - fwdInMessages: `false`

- [ ] Connect uibuilder outputs to switch-routes input
- [ ] Connect formatted data outputs to uibuilder input:
  - func-format-devices → uibuilder
  - func-format-current → uibuilder
  - func-format-charts → uibuilder
  - func-format-realtime → uibuilder

### Step 5: Integrate dashboard-flow-nodes.json

- [ ] Open Node-RED editor
- [ ] Import dashboard-flow-nodes.json into dashboard-tab
- [ ] Verify all nodes are on dashboard-tab
- [ ] Check all connections are correct
- [ ] Deploy changes

## Testing

### Test 1: Frontend Loads
- [ ] Navigate to `http://your-node-red:1880/dash`
- [ ] Verify page loads without errors
- [ ] Check browser console for errors
- [ ] Verify "Disconnected" badge appears (before Node-RED connection)
- [ ] Verify "Connected" badge appears after connection

### Test 2: Device List
- [ ] Open Node-RED debug panel
- [ ] Verify connection to uibuilder
- [ ] Check if device list loads automatically
- [ ] If not, check debug output from pg-get-devices
- [ ] Verify device dropdown populates

### Test 3: Device Selection
- [ ] Select a device from dropdown
- [ ] Verify "loading" spinner appears
- [ ] Check current data displays:
  - Battery percentage
  - Water level
  - Uptime
- [ ] Verify gauges initialize with data
- [ ] Verify charts load with historical data

### Test 4: Real-time Updates
- [ ] Trigger test uplink in farm-flow-tab:
  - Use the "Test Uplink" inject node
  - Ensure deviceEui matches selected device
- [ ] Verify gauges update in real-time
- [ ] Check console for "Received:" message
- [ ] Verify current stats update

### Test 5: Auto-refresh
- [ ] Wait 30 seconds
- [ ] Verify charts refresh automatically
- [ ] Check inject-refresh node triggers
- [ ] Verify no errors in debug panel

### Test 6: Chart Interactions
- [ ] Hover over chart lines
- [ ] Verify tooltips appear
- [ ] Check time formatting (HH:mm)
- [ ] Verify zoom/pan works
- [ ] Test on different screen sizes

## Cleanup

- [ ] Remove old @flowfuse dashboard nodes (if present)
  - ui-template nodes
  - ui-chart nodes
  - ui-gauge nodes
  - ui-dropdown nodes

- [ ] Disable old dashboard tab if keeping for reference

- [ ] Remove inject-refresh node if auto-refresh works via uibuilder

- [ ] Clean up any unused debug nodes

- [ ] Verify no broken links in flows

## Final Verification

- [ ] All database queries return data
- [ ] No errors in Node-RED logs
- [ ] No errors in browser console
- [ ] All charts display correctly
- [ ] Gauges update in real-time
- [ ] Device switching works smoothly
- [ ] Auto-refresh functions properly
- [ ] Mobile responsive design works
- [ ] Dark theme applies correctly

## Documentation

- [ ] Update README with new dashboard URL
- [ ] Document any custom configuration
- [ ] Note any differences from plan.txt
- [ ] Record performance observations
- [ ] Document any issues encountered

## Rollback Plan (If Needed)

- [ ] Restore flows.json.backup
  ```bash
  cp flows.json.backup flows.json
  ```

- [ ] Restart Node-RED
  ```bash
  # Depends on your setup, e.g.:
  sudo systemctl restart nodered
  # or
  pm2 restart node-red
  ```

## Performance Optimization (Optional)

- [ ] Add indexes to database
  ```sql
  CREATE INDEX IF NOT EXISTS idx_readings_device_eui ON readings(device_eui);
  CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
  CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_eui, ts);
  ```

- [ ] Implement data aggregation for long-term history
- [ ] Add caching for device list
- [ ] Optimize SQL queries with EXPLAIN ANALYZE

## Notes

- The existing dashboard can run in parallel during migration
- Test with a single device first before rolling out to all devices
- Monitor database performance after deployment
- Consider adding error handling for missing devices
- Add loading states for better UX

## Success Criteria

✓ Dashboard loads without errors
✓ Device list populates from database
✓ Current data displays correctly
✓ Historical charts show 24h of data
✓ Real-time updates work
✓ Gauges animate smoothly
✓ Auto-refresh works
✓ Mobile responsive
✓ No memory leaks
✓ Performance is acceptable
