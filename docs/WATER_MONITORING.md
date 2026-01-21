# Water Monitoring System - Architecture Documentation

## Overview

The water monitoring system is designed with **separation of concerns** and **configurability** in mind. It processes distance sensor data to calculate water levels, tracks flow rates, and provides real-time visualization with historical data.

## System Architecture

```
┌─────────────────┐
│  LoRaWAN Sensor │ (60s interval)
│   - Distance    │
│   - Total Vol   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   MQTT/ChirpStack│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│          Node-RED Processing Pipeline               │
│                                                     │
│  ┌──────────────┐   ┌─────────────────────────┐   │
│  │ Parse Uplink │──▶│ Extract Sensor Data     │   │
│  └──────────────┘   └──────────┬──────────────┘   │
│                                 │                   │
│                                 ▼                   │
│                    ┌────────────────────────┐      │
│                    │ Water Processor        │      │
│                    │  - Load Config         │      │
│                    │  - Calculate Level     │      │
│                    │  - Calculate Flow Rate │      │
│                    │  - Detect Anomalies    │      │
│                    └─────────┬──────────────┘      │
│                              │                      │
│                    ┌─────────┴─────────┐           │
│                    ▼         ▼         ▼           │
│                 Gauge    Volume    Flow Rate       │
│                Display   Display   Display         │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │ (Historical storage)
└─────────────────┘
```

## Configuration System

### Design Philosophy
- **Single Source of Truth**: All configuration in one place ([Configuration tab](pi/nodered/flows.json))
- **Runtime Editable**: Modify config without redeploying code
- **Type Safety**: Validated parameters with comments
- **Separation**: Tank config separate from sensor config separate from flow logic

### Configuration Parameters

```javascript
{
    // Tank Physical Dimensions
    tank: {
        height_cm: 200,          // Total tank height
        capacity_liters: 5000,   // Total capacity
        diameter_cm: 180,        // For visualization
        shape: 'cylindrical'     // Shape affects volume calculation
    },

    // Distance Sensor Configuration
    sensor: {
        mounting_height_cm: 210,     // Sensor position from ground
        offset_cm: 0,                 // Calibration offset
        min_reading_cm: 10,           // Sensor dead zone
        max_reading_cm: 220,          // Max valid reading
        field_name: 'pd'              // Data field name
    },

    // Flow Calculation
    flow: {
        reporting_interval_seconds: 60,  // Device report rate
        flow_field_name: 'tv',           // Total volume field
        enable_flow_calculation: true,
        flow_detection_threshold_liters: 5
    },

    // Alert Thresholds
    alerts: {
        low_level_percent: 20,
        critical_level_percent: 10,
        high_flow_rate_lph: 1000  // Leak detection
    }
}
```

### How to Adjust Configuration

1. **Via Node-RED UI**:
   - Navigate to Configuration tab
   - Double-click "Setup Water Tank Config" node
   - Edit the config object in the function
   - Deploy changes

2. **Initial Setup**:
   - Measure your tank height and capacity
   - Measure sensor mounting height from ground
   - Update `tank.height_cm` and `tank.capacity_liters`
   - Update `sensor.mounting_height_cm`

3. **Calibration**:
   - Fill tank to known level
   - Compare dashboard reading to actual level
   - Adjust `sensor.offset_cm` to correct
   - Redeploy and verify

## Water Level Calculation

### Algorithm

```javascript
// Step 1: Read distance from sensor (in cm)
distanceReading = sensor.pd

// Step 2: Apply calibration offset
adjustedDistance = distanceReading + config.sensor.offset_cm

// Step 3: Calculate water level
waterLevel_cm = config.sensor.mounting_height_cm - adjustedDistance

// Step 4: Constrain to tank bounds
waterLevel_cm = clamp(waterLevel_cm, 0, config.tank.height_cm)

// Step 5: Calculate percentage
waterLevel_percent = (waterLevel_cm / config.tank.height_cm) * 100

// Step 6: Calculate volume (cylindrical tank)
fillRatio = waterLevel_cm / config.tank.height_cm
waterVolume_liters = config.tank.capacity_liters * fillRatio
```

### Example
- Tank height: 200 cm
- Tank capacity: 5000 L
- Sensor mounting height: 210 cm (10 cm above tank top)
- Sensor reads: 110 cm (distance to water surface)
- Water level = 210 - 110 = 100 cm
- Fill percentage = (100 / 200) * 100 = 50%
- Volume = 5000 * 0.5 = 2500 L

## Flow Rate Calculation

### Design Principles
- **Decoupled from reporting interval**: Sampling can be independent
- **State tracking**: Uses Node-RED context to track previous readings
- **Differential calculation**: Measures change over time
- **Noise filtering**: Ignores changes below threshold

### Algorithm

```javascript
// State tracking per device
flowContext[deviceEui] = {
    lastVolume: 0,
    lastTimestamp: 0,
    flowRate: 0
}

// On new reading
currentVolume = sensor.tv
currentTime = now()

// Calculate delta
timeDelta_seconds = (currentTime - lastTimestamp) / 1000
volumeChange_liters = currentVolume - lastVolume

// Convert to flow rate (L/h)
if (volumeChange >= threshold) {
    flowRate_LPH = (volumeChange / timeDelta_seconds) * 3600

    // Update state
    lastVolume = currentVolume
    lastTimestamp = currentTime
}
```

### Benefits
1. **Accurate flow tracking** at any reporting interval
2. **Leak detection** - high flow rate alerts
3. **Usage patterns** - historical flow data
4. **Tank refill detection** - positive flow

## Dashboard Components

### 1. Water Tank Level Gauge
- **Type**: Tank-style gauge (vertical fill)
- **Range**: 0-100%
- **Colors**:
  - Red (0-10%): CRITICAL
  - Orange (10-20%): LOW
  - Yellow (20-50%): MEDIUM
  - Green (50-100%): GOOD

### 2. Volume Display
- **Format**: `{current} / {capacity} L`
- **Example**: `2500 / 5000 L`
- **Updates**: Real-time with each sensor reading

### 3. Flow Rate Display
- **Units**: Liters per hour (L/h)
- **Updates**: When flow detected (> threshold)
- **Use cases**:
  - Monitor irrigation usage
  - Detect leaks (unexpectedly high flow)
  - Track refilling

### 4. Water Flow History Chart
- **X-axis**: Time (24 hours)
- **Y-axis**: Total volume accumulated (L)
- **Update frequency**: Every 60 seconds
- **Data retention**: Last 1440 points (24h at 60s interval)

## Data Fields

### Input Data (from sensor)
```json
{
  "bp": 3,           // Battery percent
  "pd": "110",       // Distance reading (cm) - **KEY FOR WATER LEVEL**
  "tv": "1250.50",   // Total volume (L) - **KEY FOR FLOW CALCULATION**
  "ec": "0",         // Error code
  "tsr": 2040,       // Time since reset
  "_rssi": -45,      // Signal strength
  "_snr": 13.75,     // Signal quality
  "_fCnt": 30        // Frame counter
}
```

### Computed Values
- `waterLevel_cm`: Water height from tank bottom
- `waterLevel_percent`: Fill percentage
- `waterVolume_liters`: Current volume in tank
- `flowRate_LPH`: Flow rate in liters per hour
- `volumeChange_liters`: Change since last reading

## PostgreSQL Schema

The existing `readings` table stores all data:
```sql
CREATE TABLE readings (
    id SERIAL PRIMARY KEY,
    device_eui TEXT NOT NULL,
    data JSONB NOT NULL,    -- Contains all sensor fields
    ts TIMESTAMP DEFAULT NOW()
);
```

Historical queries can extract water data:
```sql
-- Water level over time
SELECT
    ts,
    (data->>'pd')::numeric as distance_cm,
    (data->>'tv')::numeric as total_volume_liters
FROM readings
WHERE ts > NOW() - INTERVAL '24 hours'
ORDER BY ts ASC;
```

## Calibration Procedure

### Initial Setup
1. Deploy the flows to Node-RED
2. Ensure sensor is sending data
3. Check Configuration tab debug output

### Distance Sensor Calibration
1. **Measure tank when empty**:
   - Note sensor reading: `distance_empty`
   - Should be ≈ `mounting_height`

2. **Fill to known level** (e.g., 50 cm):
   - Note sensor reading: `distance_50cm`
   - Expected = `mounting_height - 50`

3. **Calculate offset**:
   ```
   offset = expected_distance - actual_distance
   ```

4. **Update config**:
   ```javascript
   sensor: {
       offset_cm: calculated_offset
   }
   ```

### Flow Meter Calibration
1. **Fill tank with known volume** (e.g., 100 L)
2. **Check `tv` field** change in debug
3. If `tv` doesn't match actual volume:
   - Check sensor documentation for calibration
   - May need to adjust at sensor level

## Advanced Features

### Multi-Tank Support
To monitor multiple tanks:
1. Each device (EUI) tracks separately
2. Flow context is per-device
3. Create separate dashboard groups per device
4. Filter charts by device EUI

### Predictive Analytics
With historical data, you can:
- Predict when tank will be empty
- Identify usage patterns
- Detect abnormal consumption
- Schedule refills proactively

### Integration Possibilities
- **Alerts**: Send notifications on low level
- **Automation**: Trigger pump when low
- **Reports**: Daily/weekly usage summaries
- **API**: Expose data for external systems

## Troubleshooting

### Water level shows 0% or 100%
- Check sensor mounting height configuration
- Verify sensor is working (check debug logs)
- Calibrate offset_cm

### Flow rate always 0
- Check if `tv` field is present in data
- Verify `flow_field_name` matches actual field
- Check if volume change exceeds threshold

### Erratic readings
- Increase `flow_detection_threshold_liters`
- Check sensor stability (physical mounting)
- Filter outliers in calculation logic

### Charts not showing data
- Check PostgreSQL connection
- Verify data is being stored (check readings table)
- Ensure historical query is correct

## Performance Considerations

### Memory Usage
- Flow context stores last reading per device: ~100 bytes/device
- Chart history in context: 1440 points × 16 bytes ≈ 23 KB/device
- Acceptable for dozens of devices

### CPU Usage
- Calculations per message: <1ms
- No impact on system performance

### Database Growth
- 1 reading/min = 1440 readings/day/device
- 1 year ≈ 525,600 readings/device
- With JSONB indexing, remains performant

### Optimization Tips
1. **Add database index** on device_eui for faster queries
2. **Archive old data** older than 1 year
3. **Use materialized views** for aggregated statistics
4. **Cache config** in memory (already implemented)

## Future Enhancements

1. **Multi-sensor averaging**: Use multiple sensors for accuracy
2. **Temperature compensation**: Adjust for thermal expansion
3. **Predictive alerts**: ML-based usage prediction
4. **Mobile app**: Real-time monitoring on phone
5. **Voice integration**: "Alexa, what's my water level?"

## References

- [Node-RED Context Guide](https://nodered.org/docs/user-guide/context)
- [PostgreSQL JSONB Performance](https://www.postgresql.org/docs/current/datatype-json.html)
- [LoRaWAN Best Practices](https://lora-alliance.org/)
