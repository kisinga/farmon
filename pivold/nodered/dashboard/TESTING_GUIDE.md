# Quick Testing Guide

## Prerequisites
- Node-RED running
- PostgreSQL database accessible
- Readings table has data with `device_eui` column

## Step-by-Step Testing

### Step 1: Restart Node-RED
```bash
# Choose appropriate method for your setup:

# Systemd
sudo systemctl restart nodered

# PM2
pm2 restart node-red

# Docker
docker restart nodered

# Manual
# Ctrl+C and restart with: node-red
```

### Step 2: Verify Backend
1. Open Node-RED editor: `http://your-server:1880`
2. Go to dashboard-tab
3. Look for these nodes:
   - ✅ uibuilder (should be at x=1500, y=740)
   - ✅ switch-routes
   - ✅ func-format-realtime (NEW)
   - ✅ All PostgreSQL nodes
4. Click **Deploy** if you see any changes

### Step 3: Access Dashboard
Open browser and go to:
```
http://your-server:1880/dash
```

### Step 4: Basic Checks

#### Visual Check
- [ ] Page loads without errors
- [ ] Shows "Farm Monitor" header
- [ ] Badge shows "Connected" (green) or "Disconnected" (red)
- [ ] Device dropdown is present

#### Connection Check
Open browser console (F12) and look for:
```javascript
// Should see:
"Received:" {topic: "deviceList", payload: [...]}
```

### Step 5: Test Device List

#### Expected Behavior
1. Device dropdown automatically populates
2. Shows device names like "Device 48ca43ff..."

#### If Empty
Check database:
```sql
-- Should return > 0
SELECT COUNT(DISTINCT device_eui) FROM readings;

-- Should show devices
SELECT DISTINCT device_eui FROM readings LIMIT 5;
```

### Step 6: Test Device Selection

1. **Select a device** from dropdown
2. **Watch for:**
   - Loading spinner appears
   - Stats cards update (Battery, Water Level, Uptime)
   - Gauges animate to current values
   - Charts populate with lines

#### Browser Console
Should see:
```javascript
"Received:" {topic: "deviceData", payload: {current: {...}}}
"Received:" {topic: "chartData", payload: {battery: [...], ...}}
```

#### Node-RED Debug Panel
Should see messages flowing through:
- pg-get-devices
- func-get-current
- func-format-current
- func-get-history
- func-format-charts

### Step 7: Test Real-time Updates

#### Trigger Test Uplink
1. In Node-RED editor, go to **farm-flow-tab**
2. Find **"Test Uplink"** inject node
3. Click inject button
4. Watch dashboard

#### Expected Behavior
- Gauges update immediately
- Stats cards refresh
- Console shows: `"Received:" {topic: "realtimeUpdate", ...}`

#### Real Device Test
- Wait for actual device uplink
- Select that device in dashboard
- Values should update in real-time

### Step 8: Test Charts

#### Check All 4 Charts
1. **Battery History (24h)** - Green line
2. **Water Flow History (24h)** - Blue line
3. **RSSI History (1h)** - Orange line
4. **SNR History (24h)** - Purple line

#### Chart Interactions
- [ ] Hover shows tooltip with value
- [ ] Time axis shows HH:mm format
- [ ] Lines are smooth and colored correctly
- [ ] Area fill gradient visible

#### If Charts Empty
Check database for history:
```sql
-- Should return rows with timestamps
SELECT ts, (data->>'bp')::float as battery
FROM readings
WHERE device_eui = 'YOUR_DEVICE_EUI'
AND data->>'bp' IS NOT NULL
AND ts > NOW() - INTERVAL '24 hours'
ORDER BY ts DESC
LIMIT 10;
```

## Common Issues & Quick Fixes

### Issue: "Disconnected" Badge
**Cause:** UIBuilder not connecting
**Fix:**
1. Check Node-RED is running
2. Check uibuilder node is deployed
3. Clear browser cache and reload
4. Check browser console for connection errors

### Issue: No Device List
**Cause:** Database empty or query failing
**Fix:**
```sql
-- Check data exists
SELECT COUNT(*) FROM readings;

-- Check device_eui column
SELECT device_eui FROM readings LIMIT 5;

-- If null, may need to populate from data->>'deveui'
UPDATE readings
SET device_eui = data->>'deveui'
WHERE device_eui IS NULL;
```

### Issue: Gauges Not Showing
**Cause:** ECharts not loaded or refs not working
**Fix:**
1. Check browser console: `typeof echarts` should return "object"
2. Verify network tab shows echarts.min.js loaded
3. Check for JavaScript errors in console
4. Hard reload page (Ctrl+Shift+R)

### Issue: Charts Not Showing
**Cause:** No historical data or format issue
**Fix:**
1. Verify data in last 24 hours
2. Check browser console for errors
3. Look for: "Received: chartData" in console
4. Verify chart containers have height in dev tools

### Issue: Real-time Not Working
**Cause:** Device filter or wiring issue
**Fix:**
1. Check device filter allows selected device
2. Verify func-format-realtime is wired to uibuilder
3. Add debug node after func-format-realtime
4. Check farm-to-dash-link is connected

### Issue: PostgreSQL Errors
**Cause:** Config mismatch or query error
**Fix:**
1. Verify all dashboard PostgreSQL nodes use: `a1b2c3d4e5f6a7b9`
2. Check Node-RED logs for SQL errors
3. Test query directly in PostgreSQL
4. Verify table and column names

## Debug Checklist

Use this checklist to diagnose issues:

### Backend (Node-RED)
- [ ] Node-RED running and accessible
- [ ] Dashboard-tab visible in editor
- [ ] Deploy button not showing changes
- [ ] Debug panel shows messages flowing
- [ ] No red triangles on nodes (errors)
- [ ] PostgreSQL config node connected

### Frontend (Browser)
- [ ] Page loads completely (no 404s)
- [ ] Console shows "Received:" messages
- [ ] No JavaScript errors in console
- [ ] Vue app mounted (#app element populated)
- [ ] ECharts loaded (typeof echarts = "object")
- [ ] Network tab shows successful requests

### Database
- [ ] PostgreSQL accessible
- [ ] Table `readings` exists
- [ ] Column `device_eui` exists and populated
- [ ] Recent data (last 24 hours) present
- [ ] JSONB data has expected fields (bp, wl, tv, etc.)

### Wiring
- [ ] farm-to-dash-link connected
- [ ] dash-link-in receives messages
- [ ] device-filter wired correctly
- [ ] func-format-realtime exists and wired
- [ ] uibuilder has both input and output wires
- [ ] switch-routes connected to uibuilder output

## Success Criteria

Your dashboard is working correctly when:

✅ Page loads without errors
✅ "Connected" badge is green
✅ Device list populates automatically
✅ Selecting device loads all data
✅ All 4 gauges display and animate
✅ All 4 charts show historical data
✅ Real-time updates work when device sends data
✅ No errors in browser console
✅ No errors in Node-RED debug panel
✅ Chart interactions (hover, zoom) work
✅ Stats cards show correct values
✅ Uptime displays properly (e.g., "4d 3h 45m")

## Performance Checks

### Page Load Time
Should be < 2 seconds on local network

### Database Queries
Check PostgreSQL logs:
```sql
-- Enable query logging if needed
ALTER SYSTEM SET log_min_duration_statement = 1000; -- Log queries > 1s
SELECT pg_reload_conf();
```

### Memory Usage
Monitor in browser dev tools:
- Initial load: ~50-100 MB
- With charts loaded: ~150-200 MB
- Should not continuously increase

### Network Traffic
- Initial load: ~500 KB
- Each device selection: ~50-100 KB
- Real-time updates: ~1-5 KB

## Next Steps After Testing

Once all tests pass:

1. **Enable Auto-Refresh** (optional)
   - In dashboard-tab, enable "inject-refresh" node
   - Set to 30 seconds for chart updates

2. **Add Database Indexes**
   ```sql
   CREATE INDEX idx_readings_device_ts ON readings(device_eui, ts);
   ```

3. **Configure Alerts**
   - Add threshold checks
   - Send notifications on low battery/water

4. **Customize UI**
   - Adjust colors in index.html
   - Modify chart intervals
   - Add/remove metrics

5. **Production Checklist**
   - [ ] Add authentication
   - [ ] Configure HTTPS
   - [ ] Set up backups
   - [ ] Monitor logs
   - [ ] Document for team

## Getting Help

If issues persist:

1. **Collect Information:**
   - Browser console errors (screenshot)
   - Node-RED debug panel output
   - PostgreSQL logs
   - flows.json snippet

2. **Check Documentation:**
   - [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Architecture and debugging
   - [FLOW_SNIPPETS.md](FLOW_SNIPPETS.md) - Code examples
   - [MIGRATION_PLAN.md](MIGRATION_PLAN.md) - Detailed design

3. **Verify Configuration:**
   - Run validation script:
     ```bash
     python3 << 'EOF'
     import json
     with open('flows.json') as f:
         flows = json.load(f)
     dashboard_nodes = [n for n in flows if n.get('z') == 'dashboard-tab']
     print(f"Dashboard nodes: {len(dashboard_nodes)}")
     pg_nodes = [n for n in dashboard_nodes if n.get('type') == 'postgresql']
     for pg in pg_nodes:
         print(f"{pg.get('name')}: {pg.get('postgreSQLConfig')}")
     EOF
     ```

4. **Test Components Individually:**
   - Use inject nodes to trigger specific paths
   - Add debug nodes at each step
   - Test database queries directly
   - Test uibuilder with simple message

---

**Happy Testing! 🚀**

The dashboard is fully implemented and ready to use. If all tests pass, you have a modern, real-time monitoring dashboard for your farm sensors!
