# Node-RED Flow Snippets for UIBuilder Integration

This document contains ready-to-use Node-RED flow snippets for implementing the uibuilder dashboard.

## Critical Configuration Fixes

### Fix 1: PostgreSQL Config ID
In `dashboard-flow-nodes.json`, find and replace:

**Find:**
```json
"postgreSQLConfig": "pg-farmmon"
```

**Replace with:**
```json
"postgreSQLConfig": "a1b2c3d4e5f6a7b9"
```

## Updated Function Nodes

### func-get-current (Fixed Query)

```javascript
const deviceEui = msg.payload;

msg.params = [deviceEui];
msg.query = `
    SELECT
        ts,
        data
    FROM readings
    WHERE device_eui = $1
    ORDER BY ts DESC
    LIMIT 1
`;

flow.set('selectedDevice', deviceEui);
return msg;
```

### func-get-history (Fixed Query)

```javascript
let deviceEui = msg.payload;

if (!deviceEui) {
    deviceEui = flow.get('selectedDevice');
    if (!deviceEui) return null;
}

msg.params = [deviceEui];
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

return msg;
```

## New Function Node: func-format-realtime

**Name:** Format Real-time Update
**Position:** After `device-filter`, before `uibuilder`

```javascript
// Format real-time sensor update for frontend
const data = msg.sensorData;

if (!data) {
    node.warn('No sensor data in message');
    return null;
}

// Calculate uptime from tsr (time since reset in seconds)
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

## Updated PostgreSQL Node: pg-get-devices

**Name:** Get Devices
**Query:**

```sql
SELECT DISTINCT device_eui as eui
FROM readings
WHERE device_eui IS NOT NULL
  AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344')
ORDER BY eui
```

**Config:**
```json
{
    "id": "pg-get-devices",
    "type": "postgresql",
    "z": "dashboard-tab",
    "name": "Get Devices",
    "query": "SELECT DISTINCT device_eui as eui FROM readings WHERE device_eui IS NOT NULL AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344') ORDER BY eui",
    "postgreSQLConfig": "a1b2c3d4e5f6a7b9",
    "split": false,
    "rowsPerMsg": 1,
    "outputs": 1
}
```

## Connection Wiring

### UIBuilder Input Connections
The uibuilder node should receive messages from these nodes:
```
func-format-devices  ──┐
func-format-current  ──┼──> uibuilder (input)
func-format-charts   ──┤
func-format-realtime ──┘
```

### UIBuilder Output Connections
The uibuilder node output should connect to:
```
uibuilder (output) ──> switch-routes
```

### Complete Real-time Update Path
```
farm-to-dash-link (link out from farm-flow-tab)
    ↓
dash-link-in (link in on dashboard-tab)
    ↓
device-filter
    ↓
func-format-realtime (NEW NODE)
    ↓
uibuilder (input)
```

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      DASHBOARD TAB                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [uibuilder] ◄──┬── [func-format-devices] ◄── [pg-get-devices] ◄─┐
│       │         │                                                  │
│       │         ├── [func-format-current] ◄── [pg-exec-query] ◄─┐ │
│       │         │         ▲                                       │ │
│       │         │         │                                       │ │
│       │         ├── [func-format-charts] ◄── [pg-exec-history]   │ │
│       │         │         ▲                                       │ │
│       │         │         │                                       │ │
│       │         └── [func-format-realtime] ◄── [device-filter]   │ │
│       │                             ▲                             │ │
│       │                             │                             │ │
│       ▼                             │                             │ │
│  [switch-routes] ───────────────┬───┴─────────────────────────────┘ │
│       │                         │                                    │
│       ├── requestDeviceList ────┘                                    │
│       │                                                              │
│       ├── selectDevice ──────┬──> [func-get-current]                │
│       │                      │          │                            │
│       │                      │          └──> [pg-exec-query]         │
│       │                      │                                       │
│       │                      └──> [func-get-history]                 │
│       │                                 │                            │
│       │                                 └──> [pg-exec-history]       │
│       │                                                              │
│  [dash-link-in] ──> [device-filter]                                 │
│       ▲                                                              │
└───────┼──────────────────────────────────────────────────────────────┘
        │
┌───────┼──────────────────────────────────────────────────────────────┐
│       │                  FARM FLOW TAB                               │
├───────┼──────────────────────────────────────────────────────────────┤
│       │                                                              │
│  [MQTT in] ──> [Parse Uplink] ──> [Store Reading] ──> [Check Thresholds]
│                      │                                               │
│                      └──> [farm-to-dash-link] ─────────────────────┘ │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Import-Ready JSON Snippets

### Complete Dashboard Flow (Copy-Paste Ready)

Save this as a file and import into Node-RED:

```json
[
    {
        "id": "uib-dash-node",
        "type": "uibuilder",
        "z": "dashboard-tab",
        "name": "Farm Monitor Dashboard",
        "topic": "",
        "url": "dash",
        "fwdInMessages": false,
        "allowScripts": false,
        "allowStyles": false,
        "copyIndex": true,
        "showfolder": false,
        "x": 1500,
        "y": 700,
        "wires": [
            ["switch-routes"]
        ]
    },
    {
        "id": "switch-routes",
        "type": "switch",
        "z": "dashboard-tab",
        "name": "Route by Topic",
        "property": "topic",
        "propertyType": "msg",
        "rules": [
            {
                "t": "eq",
                "v": "requestDeviceList",
                "vt": "str"
            },
            {
                "t": "eq",
                "v": "selectDevice",
                "vt": "str"
            }
        ],
        "checkall": "true",
        "repair": false,
        "outputs": 2,
        "x": 1700,
        "y": 700,
        "wires": [
            ["pg-get-devices"],
            ["func-get-current", "func-get-history"]
        ]
    },
    {
        "id": "func-format-realtime",
        "type": "function",
        "z": "dashboard-tab",
        "name": "Format Real-time Update",
        "func": "const data = msg.sensorData;\n\nif (!data) {\n    node.warn('No sensor data');\n    return null;\n}\n\nlet uptime = '--';\nif (data.tsr) {\n    const seconds = parseInt(data.tsr);\n    const days = Math.floor(seconds / 86400);\n    const hours = Math.floor((seconds % 86400) / 3600);\n    const mins = Math.floor((seconds % 3600) / 60);\n    uptime = `${days}d ${hours}h ${mins}m`;\n}\n\nreturn {\n    topic: 'realtimeUpdate',\n    payload: {\n        battery: parseFloat(data.bp) || 0,\n        rssi: parseFloat(data._rssi) || -120,\n        snr: parseFloat(data._snr) || -20,\n        waterLevel: parseFloat(data.wl) || 0,\n        waterVolume: parseFloat(data.tv) || 0,\n        flowRate: parseFloat(data.fr) || 0,\n        uptime: uptime\n    }\n};",
        "outputs": 1,
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": 1300,
        "y": 800,
        "wires": [
            ["uib-dash-node"]
        ]
    }
]
```

## Testing Inject Nodes

### Test Device List Request
```json
{
    "id": "test-device-list",
    "type": "inject",
    "z": "dashboard-tab",
    "name": "Test: Request Device List",
    "props": [
        {
            "p": "topic",
            "vt": "str"
        }
    ],
    "repeat": "",
    "crontab": "",
    "once": false,
    "onceDelay": 0.1,
    "topic": "requestDeviceList",
    "x": 100,
    "y": 700,
    "wires": [
        ["switch-routes"]
    ]
}
```

### Test Device Selection
```json
{
    "id": "test-device-select",
    "type": "inject",
    "z": "dashboard-tab",
    "name": "Test: Select Device",
    "props": [
        {
            "p": "payload"
        },
        {
            "p": "topic",
            "vt": "str"
        }
    ],
    "repeat": "",
    "crontab": "",
    "once": false,
    "onceDelay": 0.1,
    "topic": "selectDevice",
    "payload": "48ca43fffe3f0e70",
    "payloadType": "str",
    "x": 100,
    "y": 750,
    "wires": [
        ["switch-routes"]
    ]
}
```

### Test Real-time Update
```json
{
    "id": "test-realtime",
    "type": "inject",
    "z": "dashboard-tab",
    "name": "Test: Real-time Update",
    "props": [
        {
            "p": "sensorData",
            "v": "{\"bp\":85.5,\"wl\":67,\"tv\":245,\"fr\":12,\"tsr\":345678,\"_rssi\":-85,\"_snr\":7.5}",
            "vt": "json"
        },
        {
            "p": "deviceEui",
            "v": "48ca43fffe3f0e70",
            "vt": "str"
        }
    ],
    "repeat": "",
    "crontab": "",
    "once": false,
    "onceDelay": 0.1,
    "x": 100,
    "y": 800,
    "wires": [
        ["device-filter"]
    ]
}
```

## Debug Nodes

Add these debug nodes to monitor the flow:

```json
[
    {
        "id": "debug-uib-output",
        "type": "debug",
        "z": "dashboard-tab",
        "name": "UIBuilder Output",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "true",
        "targetType": "full",
        "x": 1720,
        "y": 650,
        "wires": []
    },
    {
        "id": "debug-formatted-data",
        "type": "debug",
        "z": "dashboard-tab",
        "name": "Formatted Data to Frontend",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "true",
        "targetType": "full",
        "x": 1500,
        "y": 650,
        "wires": []
    }
]
```

Connect these debug nodes in parallel with the uibuilder input to monitor messages.

## PostgreSQL Test Queries

Run these in your PostgreSQL client to verify data:

```sql
-- Test 1: Count readings
SELECT COUNT(*) as total_readings FROM readings;

-- Test 2: Check device list
SELECT DISTINCT device_eui as eui
FROM readings
WHERE device_eui IS NOT NULL
  AND device_eui NOT IN ('unknown', '0011223344556677', 'aabbccdd11223344')
ORDER BY eui;

-- Test 3: Check latest reading structure
SELECT device_eui, ts, data
FROM readings
ORDER BY ts DESC
LIMIT 1;

-- Test 4: Verify JSONB fields exist
SELECT
    device_eui,
    data->>'bp' as battery,
    data->>'wl' as water_level,
    data->>'_rssi' as rssi,
    data->>'_snr' as snr
FROM readings
WHERE device_eui = '48ca43fffe3f0e70'
ORDER BY ts DESC
LIMIT 5;

-- Test 5: Test historical query (battery)
SELECT ts, (data->>'bp')::float as value
FROM readings
WHERE device_eui = '48ca43fffe3f0e70'
  AND ts > NOW() - INTERVAL '24 hours'
  AND data->>'bp' IS NOT NULL
ORDER BY ts
LIMIT 10;
```

## Frontend Files Deployment Script

```bash
#!/bin/bash
# deploy-dashboard.sh

UIBUILDER_DIR="$HOME/.node-red/uibuilder/dash/src"

# Create directory if it doesn't exist
mkdir -p "$UIBUILDER_DIR"

# Extract index.html from plan.txt (lines 6-151)
sed -n '6,151p' dashboard/plan.txt > "$UIBUILDER_DIR/index.html"

# Extract index.js from plan.txt (lines 165-437)
sed -n '165,437p' dashboard/plan.txt > "$UIBUILDER_DIR/index.js"

# Copy CSS
cp dashboard/index.css "$UIBUILDER_DIR/"

echo "Dashboard files deployed to $UIBUILDER_DIR"
ls -lh "$UIBUILDER_DIR"
```

Make it executable:
```bash
chmod +x deploy-dashboard.sh
./deploy-dashboard.sh
```

## Verification Checklist

After implementing these snippets:

- [ ] All PostgreSQL nodes use config ID: `a1b2c3d4e5f6a7b9`
- [ ] All queries use `device_eui` column, not `data->>'deveui'`
- [ ] `func-format-realtime` node exists and is wired
- [ ] UIBuilder node has both input and output connections
- [ ] Switch router has 2 outputs correctly wired
- [ ] Test inject nodes work when triggered
- [ ] Debug nodes show expected messages
- [ ] Frontend files deployed to uibuilder directory
- [ ] No broken wires in Node-RED flow
- [ ] Deploy button clicked and flows restarted

## Common Wiring Mistakes

❌ **Wrong:** UIBuilder output not connected
✅ **Right:** UIBuilder output → switch-routes

❌ **Wrong:** Formatted data nodes send to switch-routes
✅ **Right:** Formatted data nodes send to UIBuilder input

❌ **Wrong:** Real-time path bypasses device-filter
✅ **Right:** dash-link-in → device-filter → func-format-realtime → uibuilder

❌ **Wrong:** Query nodes reference wrong PostgreSQL config
✅ **Right:** All query nodes use `a1b2c3d4e5f6a7b9`

## Next Steps

1. Copy the fixed function code into your existing nodes
2. Import the JSON snippets for new nodes
3. Update PostgreSQL config IDs
4. Wire everything according to the diagram
5. Deploy frontend files
6. Test with inject nodes
7. Monitor debug output
8. Access dashboard at `http://your-server:1880/dash`
