# Pump Controller Reference — Heltec V3

Firmware commit: `6c846922b0189a47e706836a605fa3a83cd9836c` (2026-04-03)

## Pin Mapping

### Pump Relay
| Function     | GPIO   | Notes                        |
|-------------|--------|-------------------------------|
| Pump relay  | GPIO42 | Active LOW (inverted), ALWAYS_OFF on boot |

### Motorized Ball Valves (2-pin each, with hardware interlock)
| Valve | Function              | Open Pin | Close Pin |
|-------|-----------------------|----------|-----------|
| V1    | Tank 1 Outlet         | GPIO4    | GPIO5     |
| V2    | Tank 2 Outlet         | GPIO6    | GPIO7     |
| V3    | Pump to Tank 2 (refill) | GPIO2  | GPIO3     |
| V4    | Pump to House 2       | GPIO39   | GPIO40    |

All valve pins: active LOW (inverted), ALWAYS_OFF on boot, 100ms interlock wait between open/close.

### Flow Sensors (Pulse Counter)
| Sensor       | GPIO   | Mode         | Notes                     |
|-------------|--------|--------------|---------------------------|
| House 1 Flow | GPIO45 | INPUT_PULLUP | Informational only         |
| House 2 Flow | GPIO46 | INPUT_PULLUP | Safety watchdog monitored  |

### Tank Level Sensors (ADC)
| Sensor       | GPIO   | Attenuation | Current Sensor Type              |
|-------------|--------|-------------|----------------------------------|
| Tank 1 Level | GPIO19 | 12dB        | 4-20mA with shunt resistor       |
| Tank 2 Level | GPIO20 | 12dB        | 4-20mA with shunt resistor       |

### OLED Display (SSD1306 128x64, I2C)
| Function   | Pin    |
|-----------|--------|
| Reset     | GPIO21 |
| I2C Addr  | 0x3C   |

### Battery ADC
| Function     | GPIO   | Divider |
|-------------|--------|---------|
| Battery ADC | GPIO1  | 2.0     |

---

## Key Configuration Parameters

| Parameter               | Value  | Description                                    |
|------------------------|--------|------------------------------------------------|
| `update_interval`      | 5s     | Sensor polling interval                        |
| `valve_travel_time`    | 15s    | Time for ball valve to fully open/close        |
| `max_runtime_seconds`  | 1800   | 30 min max pump run before fault               |
| `flow_watchdog_seconds`| 30     | No-flow timeout on House 2 path                |
| `flow_confirm_seconds` | 15     | Flow must sustain 15s to count as "confirmed"  |
| `flow_cal`             | 450.0  | Pulse-to-L/min calibration factor              |
| `flow_threshold`       | 0.5    | L/min minimum to count as flow                 |
| `refill_watchdog_seconds`| 60   | Level-rise check window on refill path         |
| `refill_min_rise_pct`  | 0.5    | Minimum % rise in watchdog window              |
| `api_watchdog_seconds` | 300    | 5 min without HA connection triggers fault      |

---

## State Machine

```
IDLE(0) --> PREPARING(1) --> RUNNING(2) --> STOPPING(3) --> IDLE(0)
                  \                /
                   +--> FAULT(4) <-+
```

### Valid Pump Routes
| Route      | Inlet (valve) | Outlet (valve) | Description          |
|-----------|---------------|----------------|----------------------|
| T1 -> T2  | 1 (V1)        | 3 (V3)         | Tank 1 refills Tank 2 |
| T1 -> H2  | 1 (V1)        | 4 (V4)         | Tank 1 to House 2    |
| T2 -> H2  | 2 (V2)        | 4 (V4)         | Tank 2 to House 2    |
| T2 -> T2  | **REJECTED**  | **REJECTED**   | Self-loop blocked    |

### Fault Codes
| Code | Meaning                    | Watchdog                      |
|------|----------------------------|-------------------------------|
| 0    | None                       | —                             |
| 1    | No flow (House 2 path)     | flow_house2 < 0.5 L/min for 30s |
| 2    | No level rise (refill)     | Tank 2 didn't rise 0.5% in 60s  |
| 3    | Max runtime exceeded       | Pump ran > 30 minutes         |
| 4    | HA API connection lost     | Disconnected > 5 minutes      |
| 5    | Source tank empty           | Source tank < 3%              |

### Safety Features
- **Pump relay guard**: GPIO-level block — relay won't energize unless `system_state == 2 (RUNNING)`
- **Safety override switch**: Bypasses all watchdogs; resets to OFF on every boot
- **Pump-disturbed readings**: Tank level readings are held (last-known-good) when that tank is the active pump source, because pump operation disturbs the pressure reading on the inlet line
- **Boot sequence**: Pump OFF, all valves closed, all state variables reset

---

## Tank Level Calibration System

The firmware uses **voltage-based calibration** adjustable from Home Assistant (no reflash needed):

| HA Entity                        | ID              | Default | Purpose               |
|----------------------------------|-----------------|---------|------------------------|
| `number.pump_ctrl_tank_1_cal_empty_v` | tank1_cal_empty | 0.0 V   | Voltage at 0% (empty) |
| `number.pump_ctrl_tank_1_cal_full_v`  | tank1_cal_full  | 3.3 V   | Voltage at 100% (full)|
| `number.pump_ctrl_tank_2_cal_empty_v` | tank2_cal_empty | 0.0 V   | Voltage at 0% (empty) |
| `number.pump_ctrl_tank_2_cal_full_v`  | tank2_cal_full  | 3.3 V   | Voltage at 100% (full)|

Diagnostic entities expose raw ADC voltage for calibration:
- `sensor.pump_ctrl_tank_1_raw_voltage`
- `sensor.pump_ctrl_tank_2_raw_voltage`

Formula: `level_pct = (V_raw - V_empty) / (V_full - V_empty) * 100`, clamped to 0-100%.

---

## Migrating to 0-3.3V 0-15 PSI Pressure Sensor

### What changes

The current setup uses **4-20mA** pressure sensors with shunt resistors to convert current to a voltage readable by the ESP32 ADC. A standard **0-3.3V output, 0-15 PSI** pressure sensor eliminates the shunt resistor — it outputs voltage directly.

### Hardware changes

| Item | Current (4-20mA)                           | New (0-3.3V)                     |
|------|---------------------------------------------|----------------------------------|
| Sensor wiring | 2-wire loop + shunt resistor to ADC | 3-wire: VCC, GND, Signal to ADC |
| Shunt resistor | Required (e.g. 165 ohm for 0.66-3.3V) | **Remove** — not needed        |
| Power supply | Loop-powered (typically 24V)           | 3.3V or 5V (check sensor spec)  |
| Signal to ESP32 | Voltage across shunt on GPIO19/20   | Signal wire directly to GPIO19/20 |

**Wiring for the new sensor:**
```
Sensor VCC  -->  3.3V (or 5V per sensor datasheet)
Sensor GND  -->  GND (shared with ESP32)
Sensor OUT  -->  GPIO19 (Tank 1) or GPIO20 (Tank 2)
```

### Firmware changes: NONE required

The existing firmware already works perfectly with a 0-3.3V sensor. Here's why:

1. **ADC config**: `attenuation: 12db` on an ESP32 reads 0-3.3V — matches the sensor range exactly
2. **Calibration**: The voltage-based calibration numbers (V_empty, V_full) are already exposed to HA
3. **No hardcoded conversion**: The firmware does a linear interpolation between two voltage points — it doesn't care whether the voltage came from a shunt resistor or a direct sensor output

### Calibration procedure after swapping sensors

1. **Install the new sensor** at the bottom of the tank (or at the pipe tap point)
2. **Empty condition**: With tank empty (or at your desired 0% reference), read the raw voltage from `sensor.pump_ctrl_tank_X_raw_voltage` in HA
3. **Set empty cal**: Enter that voltage into `number.pump_ctrl_tank_X_cal_empty_v`
4. **Full condition**: With tank full (or at your desired 100% reference), read the raw voltage
5. **Set full cal**: Enter that voltage into `number.pump_ctrl_tank_X_cal_full_v`
6. Values persist across reboots (`restore_value: true`)

### Tank Specifications

| Tank   | Height | Capacity | Elevation | Sensor location |
|--------|--------|----------|-----------|-----------------|
| Tank 1 | ~2 m   | 10,000 L | Ground level | Ground level (at tank base) |
| Tank 2 | ~2 m   | 10,000 L | ~3 m elevated | Ground level (below tank)   |

**Important**: Both sensors are installed at ground level. The sensor reads the total water column height above it. This means:
- **Tank 1**: sensor sees 0–2m (just the water in the tank)
- **Tank 2**: sensor sees ~3–5m (3m of elevation + 0–2m of water in the tank)

Tank 2's sensor never reads zero — even when the tank is empty, there's ~3m of head from the pipe/elevation above.

### Expected voltage range (0-3.3V, 0-15 PSI sensor)

The sensor maps 0-15 PSI linearly to 0-3.3V:

| Tank | Condition | Water head | Pressure | Voltage |
|------|-----------|------------|----------|---------|
| T1   | Empty     | 0 m        | 0.0 PSI  | 0.00 V  |
| T1   | Full      | 2 m        | 2.84 PSI | 0.626 V |
| T2   | Empty     | 3 m        | 4.27 PSI | 0.939 V |
| T2   | Full      | 5 m        | 7.11 PSI | 1.565 V |

> Conversion: 1 PSI = 0.703 m water column; V = (head_m / 0.703 / 15) * 3.3

**Tank 1** uses ~19% of ADC range (0–0.63V), ~780 ADC levels — adequate.
**Tank 2** uses a better part of the range (0.94–1.57V), ~620 ADC levels across a 0.63V span, and sits in a less noisy region of the ESP32 ADC.

### Calibration values (expected)

| Entity | Tank 1 | Tank 2 |
|--------|--------|--------|
| `cal_empty` | ~0.00 V | ~0.94 V |
| `cal_full`  | ~0.63 V | ~1.57 V |

These are estimates — use the raw voltage diagnostic sensors to read the actual values after installation.

### Considerations

- **Sensor supply voltage**: Some "0-3.3V" sensors need 5V supply but output 0-3.3V signal. Check the datasheet. If it needs 5V, power it from the USB/5V rail, not the 3.3V pin.
- **Ground loop**: Share a common ground between sensor and ESP32.
- **Cable length**: Tank 2 is elevated ~3m, so the cable run will be longer. For runs over ~2m, use shielded cable to reduce ADC noise. A small capacitor (100nF) from the signal pin to GND can also help.
- **ADC noise**: The ESP32 ADC is noisy at low voltages, and you'll be operating in the 0–0.63V range. If readings are jittery, add a software moving average filter in the ESPHome config. The existing `update_interval: 5s` already provides some natural smoothing.
- **15 PSI is overkill for 2m tanks**: You're only using ~3 PSI of the 15 PSI range. A **0-5 PSI** sensor (if available with 0-3.3V output) would give 3x better resolution and use more of the ADC range (~1.88V at full). But 15 PSI works fine — just less precise.
