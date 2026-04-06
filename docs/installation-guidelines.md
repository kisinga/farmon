# MajiFlow — Installation Guidelines

Physical installation guidelines for water system components managed by MajiFlow. These guidelines apply to the hardware side — the app handles configuration and code generation.

---

## Flow Sensors

### Placement — The 10D/5D Rule

Flow sensors require straight, undisturbed pipe upstream and downstream for accurate readings:

- **10D upstream**: 10 pipe diameters of straight pipe before the sensor
- **5D downstream**: 5 pipe diameters of straight pipe after the sensor

For a 1" (25mm) pipe: 250mm straight before, 125mm straight after.

Avoid placing sensors immediately after:
- Elbows, tees, or reducers
- Partially open valves
- Pump outlets (turbulence)

### Mounting Orientation

- Mount **horizontally** with the impeller axis vertical
- Ensure the arrow on the sensor body matches flow direction
- The sensor must be fully flooded (no air pockets)

### Sensor Sizing

Match the sensor to the pipe diameter. An oversized sensor in a small pipe will under-read; an undersized sensor will create excessive pressure drop.

| Sensor Model | Pipe Size | Flow Range | Pulses/L |
|-------------|-----------|------------|----------|
| YF-S201 | 1/2" (DN15) | 1–30 L/min | ~450 |
| YF-S401 | 1" (DN25) | 0.3–10 L/min | ~5880 |
| YF-DN50 | 2" (DN50) | 10–200 L/min | ~55 |

Calibrate `flow_cal` (pulses/L) for your specific sensor — manufacturer values are approximate.

### Electrical

- Use shielded cable for runs > 2m to reduce electrical noise
- Pull-up resistor (10kΩ to 3.3V) is recommended if not built into the sensor
- MajiFlow configures `INPUT_PULLUP` by default in ESPHome

---

## Valves

### Motorized Ball Valves

- Mount **horizontally** or with the actuator **above** the pipe (never below — condensation risk)
- Ensure the valve is accessible for manual override
- Default travel time: **15 seconds** — adjust `valve_travel_time` in the topology if using faster/slower actuators

### Wiring

- 2-wire control: one wire for OPEN direction, one for CLOSE direction
- **Never energize both directions simultaneously** — MajiFlow generates ESPHome interlocks to prevent this
- Wire gauge: 18 AWG minimum for runs up to 15m; 16 AWG for longer runs
- Relay/MOSFET board must handle the motor stall current (typically 0.5–1.5A)

---

## Tank Level Sensors

### Pressure-Based Level Sensing (ADC)

MajiFlow uses analog pressure sensors at the tank bottom to measure water column height.

- Mount at the **lowest point** of the tank, or on a standpipe connected to the bottom
- The sensor must be **below** the minimum water level
- Use a bleed valve or T-fitting for easy sensor removal/calibration

### Calibration

Calibrate via Home Assistant number entities:
1. **Cal Empty (V)**: Voltage reading when tank is empty
2. **Cal Full (V)**: Voltage reading when tank is full

MajiFlow generates these as adjustable HA entities. The firmware calculates percentage as:
```
pct = clamp((voltage - v_empty) / (v_full - v_empty) * 100, 0, 100)
```

### Reading Suppression

Tank readings are **suppressed during pump operation** (PREPARING, RUNNING, STOPPING states) because the pump creates pressure artifacts. Levels are only trusted when the pump is IDLE or FAULT.

---

## Pressure Sensors

### Water Source Pressure Monitoring

For WaterSource nodes with a `pressure_pin`, an ADC pressure sensor monitors incoming supply pressure (mains, borehole).

- Mount **after** any pressure regulator and **before** the first branch/valve
- Use a sensor rated for the expected pressure range (typically 0–10 bar for mains)
- Install a snubber or damper if the supply has water hammer

### Sensor Selection

| Type | Range | Output | Notes |
|------|-------|--------|-------|
| 0–10 bar, 0.5–4.5V | Mains supply | Analog (ADC) | Most common for residential |
| 0–6 bar, 4–20mA | Low pressure | Requires signal converter | Better noise immunity |

---

## General Piping Notes

> These are outside MajiFlow's domain but relevant to a safe installation.

- **Pipe sizing**: Match pipe diameter to expected flow rates. Undersized pipes increase pressure drop and reduce sensor accuracy.
- **Pressure regulators**: Install upstream of the system if mains pressure exceeds component ratings (typically >6 bar).
- **Check valves**: Consider non-return valves to prevent backflow, especially on tank inlet lines.
- **Strainers/filters**: Install upstream of flow sensors to prevent debris from fouling the impeller.
- **Float switches**: **Required** on every destination tank as a hardware safety interlock independent of the ESP32 (see [System Architecture](pump-system-architecture.md#tank-to-tank-overflow-protection)).

## Electrical Notes

> Brief reference — consult a qualified electrician for your installation.

- **Relay board**: Must handle the total inrush current of all simultaneously energized actuators
- **Power supply**: 12V or 24V DC for valve motors; 3.3V logic for ESP32 GPIOs
- **Grounding**: Ensure all metallic pipes and the relay board share a common ground
- **Wire runs**: Keep signal wires (sensors) separated from power wires (motors, pump relay) to reduce interference
