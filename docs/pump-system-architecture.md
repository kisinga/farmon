# Pump System — Architecture

## Hardware

| Component | Qty | Notes |
|-----------|-----|-------|
| ESP32 | 1 | State machine + all safety logic |
| Relay/MOSFET board | 1 | Drives all actuators from ESP32 GPIOs |
| Pump relay | 1 | Single water pump |
| Motorised ball valves | 4 | 2-pin each (open/close direction) |
| Water flow sensors | 3 | Pulse counter — House 1 (gravity), House 2 (pump), Refill line |
| Tank level sensors | 2 | Analog pressure — Tank 1 (rain-fed), Tank 2 |
| Float switches | per dest tank | High-level overflow protection on every destination tank |

## Topology

```
Tank 1 (rain) → valve1 ──────────────────┐
Tank 2 ───────→ splitter → valve2 ───────┤→ PUMP → valve3 → flow3 → Tank 2 inlet
                    └→ flow_house1 → H1   └──────→ valve4 → flow_house2 → H2
```

**Key**: House 1 is gravity-fed from Tank 2 (always on, no pump). House 2 is pump-fed.

## Operating Modes

### Rainy Season
Tank 1 fills from rain. Priority: **keep Tank 2 full** for gravity-fed House 1.

| Parameter | Default | Purpose |
|-----------|---------|---------|
| Tank 2 refill trigger | 80% | Start refill when Tank 2 drops below |
| Tank 2 refill stop | 90% | Stop refill when Tank 2 reaches |
| Tank 1 stop pumping | 20% | Don't drain Tank 1 below (rain will replenish) |
| Preferred House 2 source | Tank 1 | Abundant, free rainwater |

### Dry Season
No rain. Priority: **conserve Tank 1** (finite reservoir).

| Parameter | Default | Purpose |
|-----------|---------|---------|
| Tank 2 refill trigger | 10% | Only refill Tank 2 when critically low |
| Tank 2 refill stop | 40% | Small batches to save energy |
| Tank 1 stop pumping | 70% | Aggressive conservation — keep 70%+ in Tank 1 |
| Preferred House 2 source | Tank 2 | Preserve Tank 1 reserves |

### How mode thresholds work
```
input_select.operating_mode = "Rainy Season" | "Dry Season"
                                      │
                    ┌─────────────────┘
                    ▼
            Template sensors resolve active values:
              sensor.active_tank_2_refill_trigger  ← rainy or dry input_number
              sensor.active_tank_2_refill_stop     ← rainy or dry input_number
              sensor.active_tank_1_min_level       ← rainy or dry input_number
              sensor.preferred_house_2_source       ← Tank 1 or Tank 2
                    │
                    ▼
            Automations use active values (mode-agnostic)
```

All thresholds are adjustable per mode from the Settings dashboard tab.

## Alerts

| Alert | Trigger | Debounce |
|-------|---------|----------|
| **WATER CRITICAL** | Average of both tanks < 35% | 5 min |
| **Tank 1 Critical** | Tank 1 < 20% (absolute) | 5 min |
| **Refill Stopped — Conservation** | Tank 1 hits mode-specific min during refill | Immediate |
| **PUMP FAULT** | Any ESP32 safety check fails | Immediate |
| **Pump Stopped** | Clean stop (manual, tank full, max runtime) | Immediate |

## Safety Model

### "Every Route Has a Flow Sensor"

Every pump route has a dedicated flow sensor. The safety monitor uses flow-based
monitoring unconditionally — no watchdog strategy dispatch, no fallback modes.

```
Path A: pump → valve4 → flow_house2 → House 2      ← flow sensor (flow2)
Path B: pump → valve3 → flow_refill → Tank 2 inlet  ← flow sensor (flow3)
Path C: pump → valve1 → valve4 → flow_house2 → H2   ← flow sensor (flow2)
```

Tank pressure sensors are **suppressed during pump operation** (states PREPARING,
RUNNING, STOPPING) because the pump creates pressure artifacts that corrupt
readings. Tank levels are only trusted when the pump is off (IDLE, FAULT).

### Flow watchdog (every route, every 2s while RUNNING)

| Condition | Result |
|-----------|--------|
| Flow never established after `flow_confirm_seconds` | **FAULT: no_flow** |
| Flow confirmed, then stops for `flow_watchdog_seconds` | **Clean stop: tank full** |
| Flow continues past `max_runtime_s` (per-route) | **FAULT: max_runtime** |

### Pre-flight checks (before pump starts, readings are clean)

| Check | Threshold | Action |
|-------|-----------|--------|
| Source tank too low | < 5% | Reject start (not a fault) |
| Dest tank already full | > 95% | Reject start (not a fault) |
| System not IDLE | state != 0 | Reject start |
| Invalid route_id | out of range | Reject start |

### All runtime safety checks (ESP32, every 2s while RUNNING)

| # | Check | Fault Code | Threshold |
|---|-------|-----------|-----------|
| 1 | Flow watchdog | `no_flow` (1) | No pulses for `flow_watchdog_seconds` |
| 2 | Per-route max runtime | `max_runtime` (2) | Route-specific `max_runtime_s` ceiling |
| 3 | API watchdog | `api_lost` (3) | HA disconnected for `api_watchdog_seconds` |

### Stop reasons (persists across runs for HA display)

| Code | Reason | Trigger |
|------|--------|---------|
| 0 | None | Initial state |
| 1 | Manual stop | User called `pump_stop` |
| 2 | Tank full | Flow confirmed then stopped (backpressure) |
| 3 | No flow | Fault code 1 + offset |
| 4 | Max runtime | Fault code 2 + offset |
| 5 | API lost | Fault code 3 + offset |

### Fault response (universal)
```
Kill pump → HA event (esphome.pump_fault) → close all valves → FAULT (latched)
```
Requires `fault_reset` service call from HA to return to IDLE.

### Clean stop response
```
HA event (esphome.pump_stopped) → kill pump → depressurize 2s → close all valves → IDLE
```

### Tank-to-tank overflow protection

For routes with a destination tank (e.g., T1→T2), flow-based "tank full" detection
relies on backpressure stopping flow. **Open tanks don't create backpressure**, so
the flow sensor won't detect overflow.

**Mitigations (layered):**
1. **Pre-start check**: dest tank > 95% → reject start
2. **Per-route max_runtime_s**: sized to tank capacity (e.g., 600s for T1→T2)
3. **Hardware float switch** (REQUIRED): high-level switch on every destination tank

## State Machine

```
IDLE ──→ PREPARING ──→ RUNNING ──→ STOPPING ──→ IDLE
            │              │
            └──→ FAULT ←───┘ ──→ IDLE (fault_reset)
```

### Tank sensor suppression by state

| State | Tank readings | Reason |
|-------|--------------|--------|
| IDLE (0) | Valid | Pump off, pressure settled |
| PREPARING (1) | **Suppressed** | Valves moving, minor transients |
| RUNNING (2) | **Suppressed** | Pump creates pressure artifacts |
| STOPPING (3) | **Suppressed** | Depressurizing, valves closing |
| FAULT (4) | Valid | Pump off, valves closed |

Suppression applies to any tank that is the **source or destination** of the active route.

## Responsibility Split

| Concern | Owner |
|---------|-------|
| State machine, valve sequencing, pump relay | **ESP32** |
| Flow watchdog (unconditional on every route) | **ESP32** |
| Per-route max runtime, API watchdog | **ESP32** |
| Pre-flight validation (source/dest levels) | **ESP32** |
| Pump relay guard (blocks direct toggle) | **ESP32** |
| Tank sensor suppression during pump operation | **ESP32** |
| HA event notifications (pump_stopped, pump_fault) | **ESP32** |
| Operating mode selection | **HA** |
| Active threshold resolution | **HA** |
| Auto-refill trigger + Tank 1 conservation stop | **HA** |
| Duration timer (user-configurable) | **HA** (ESP32 has per-route max) |
| Dashboard, notifications, logging | **HA** |

## Auto-Refill Flow

```
Tank 2 < active_trigger for 1 min
  AND auto_refill = ON
  AND state = IDLE
  AND Tank 1 > active_tank1_min
  │
  ▼ Start: Tank 1 → Tank 2
  │
  ├─ Flow stops (tank full) → Stop (clean)
  ├─ Tank 1 ≤ active_tank1_min → Stop via HA (conservation)
  ├─ Duration timer expires → Stop via HA
  ├─ Per-route max_runtime → FAULT (ESP32 hard limit)
  └─ No flow detected → FAULT (blockage/dry source)
```

## HA Event Notifications

The ESP32 fires `esphome.pump_event` on every state transition:

| Event type | Data fields | When |
|-----------|-------------|------|
| `stopped` | route, reason | Clean stop (manual, tank full) |
| `fault` | route, fault | Any fault condition |

HA automations can listen for these to send mobile notifications, log events, etc.

## Installation Guidelines

### Flow Sensors
- One flow sensor per pump output path (not optional)
- Mount downstream of the last valve in each route
- Use pulse-counter type (YF-S201 or similar)

### Tank Level Sensors (Pressure)
- Mount at the bottom of the tank on a standpipe if possible
- Readings are suppressed during pump operation — accuracy only matters when pump is off
- Calibrate empty/full voltages via HA number entities

### Float Switches (REQUIRED for destination tanks)
- Every tank that is a destination in any route must have a high-level float switch
- Mount at the maximum safe fill level
- Wire as a hardware safety interlock (independent of ESP32 software)
- This is the last line of defense against overflow for tank-to-tank routes

### Valves
- Motorised ball valves with 2-wire control (open/close)
- Default travel time: 15s — adjust `valve_travel_time` if different
- Hardware interlocked in ESPHome (open and close pins can't be active simultaneously)

## GPIO Pin Map

| Pin | Function | Type |
|-----|----------|------|
| GPIO42 | Pump relay | Output |
| GPIO4/5 | Valve 1 open/close | Output |
| GPIO6/7 | Valve 2 open/close | Output |
| GPIO2/3 | Valve 3 open/close | Output |
| GPIO39/40 | Valve 4 open/close | Output |
| GPIO45 | Flow sensor H1 | Input (pulse) |
| GPIO46 | Flow sensor H2 | Input (pulse) |
| GPIO47 | Flow sensor Refill | Input (pulse) |
| GPIO19 | Tank 1 level | Input (ADC) |
| GPIO20 | Tank 2 level | Input (ADC) |

15 pins used (10 output, 5 input). ~6 free GPIOs remaining on Heltec V3.
