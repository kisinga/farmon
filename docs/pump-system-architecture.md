# Pump System — Architecture

## Hardware

| Component | Qty | Notes |
|-----------|-----|-------|
| ESP32 | 1 | State machine + all safety logic |
| Relay/MOSFET board | 1 | Drives all actuators from ESP32 GPIOs |
| Pump relay | 1 | Single water pump |
| Motorised ball valves | 4 | 2-pin each (open/close direction) |
| Pressure relief solenoid | 1 | Normally closed, opens on fault |
| Water flow sensors | 2 | Pulse counter — House 1 (gravity), House 2 (pump) |
| Tank level sensors | 2 | Analog — Tank 1 (rain-fed), Tank 2 |

No pressure transducer or valve limit switches required.

## Topology

```
Tank 1 (rain) → valve1 ──────────────────┐
Tank 2 ───────→ splitter → valve2 ───────┤→ PUMP → valve3 → Tank 2 inlet
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

## Safety Model

### "Flow is Truth" — path-dependent watchdog

Two flow paths exist, but **only one has a flow sensor**:

```
Path A: pump → valve4 → flow_house2 → House 2   ← HAS flow sensor
Path B: pump → valve3 → Tank 2 inlet            ← NO flow sensor
```

The safety monitor uses **different confirmation strategies** per path:

| Outlet | Watchdog | How it works | Timeout |
|--------|----------|-------------|---------|
| valve4 (House 2) | **Flow sensor** | `flow_house2 > 0.1 L/min` | 30s |
| valve3 (Refill) | **Tank level rise** | `tank2_level` must increase ≥ 0.5% per window | 60s |

Both cover the same failure modes (stuck valve, dry tank, blockage) — just
with different observable signals.

### All safety checks (ESP32, every 2s while RUNNING)

| # | Check | Code | Threshold |
|---|-------|------|-----------|
| 1 | Flow watchdog (House 2 path) | `no_flow` | No pulses for 30s |
| 2 | Level rise watchdog (Refill path) | `no_level_rise` | < 0.5% rise in 60s |
| 3 | Max runtime | `max_runtime` | 30 min hard ceiling |
| 4 | API watchdog | `api_lost` | HA disconnected 5 min |
| 5 | Source tank depleted | `source_empty` | Source < 3% during run |

Pre-flight: source > 5%, valid inlet/outlet, no loop, system IDLE.

### Fault response (universal)
```
Kill pump → open relief solenoid 10s → close all valves → FAULT (latched)
```
Requires `fault_reset` service call from HA to return to IDLE.

## State Machine

```
IDLE ──→ PREPARING ──→ RUNNING ──→ STOPPING ──→ IDLE
            │              │
            └──→ FAULT ←───┘ ──→ IDLE (fault_reset)
```

## Responsibility Split

| Concern | Owner |
|---------|-------|
| State machine, valve sequencing, pump relay | **ESP32** |
| Flow watchdog, level rise watchdog | **ESP32** |
| Max runtime, API watchdog, source depletion | **ESP32** |
| Pump relay guard (blocks direct toggle) | **ESP32** |
| Pre-flight validation | **ESP32** |
| Operating mode selection | **HA** |
| Active threshold resolution | **HA** |
| Auto-refill trigger + Tank 1 conservation stop | **HA** |
| Duration timer (user-configurable) | **HA** (ESP32 has hard max) |
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
  ├─ Tank 2 ≥ active_stop → Stop (target reached)
  ├─ Tank 1 ≤ active_tank1_min → Stop (conservation)
  ├─ Duration timer expires → Stop (HA timer)
  ├─ Max runtime 30min → FAULT (ESP32 hard limit)
  └─ No level rise 60s → FAULT (path blocked)
```

## GPIO Pin Map

| Pin | Function | Type |
|-----|----------|------|
| GPIO16 | Pump relay | Output |
| GPIO17/18 | Valve 1 open/close | Output |
| GPIO19/5 | Valve 2 open/close | Output |
| GPIO22/23 | Valve 3 open/close | Output |
| GPIO25/26 | Valve 4 open/close | Output |
| GPIO33 | Pressure relief | Output |
| GPIO27 | Flow sensor H1 | Input (pulse) |
| GPIO32 | Flow sensor H2 | Input (pulse) |
| GPIO34 | Tank 1 level | Input (ADC) |
| GPIO35 | Tank 2 level | Input (ADC) |

14 pins used (10 output, 4 input). ~4-6 free GPIOs remaining.
