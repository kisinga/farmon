---
slug: troubleshooting
title: Troubleshooting & Recovery
category: narrative
node_kind: 
order: 20
---

For maintenance technicians — how a controller decides to stop a route, how faults reach you, and how to recover. **All safety logic runs on the ESP32; there is no server dependency.** In managed mode each controller operates independently; in local mode controllers coordinate directly over UDP.

## State machine

```
IDLE → PREPARING → RUNNING → STOPPING → IDLE
                     │
                     └──→ FAULT (latched) ──→ IDLE  (Reset faults)
```

Tank level readings are **suppressed during PREPARING / RUNNING / STOPPING** (pump pressure and valve movement create artifacts) and valid in IDLE / FAULT.

## Runtime safety checks

| # | Check | Fault | Threshold |
|---|---|---|---|
| 1 | Flow watchdog | `no_flow` | No pulses for {{flow_watchdog}} s after the {{flow_confirm}} s confirm window |
| 2 | Per-route max runtime | `max_runtime` | The route's configured time ceiling |

## Fault vs clean stop

- **Fault** — kill the pump, close all valves, latch **FAULT**, and publish the fault over MQTT to the server. Clear the cause, then send **Reset faults** from the dashboard to return to IDLE.
- **Clean stop** — kill the pump, depressurize briefly, close all valves, return to **IDLE**. The stop reason (manual, tank full) is published over MQTT.

## Control-loss fail-safe (local mode)

When a controller drives an actuator on behalf of a peer (a cross-controller route), the peer holds a **timed claim** (the dead-man lease). The owner runs the actuator only while a live claim exists. If the peer link drops and the claim stops being renewed, the claim expires and the next tick stops the pump / closes the valve. That positive model **is** the local-mode control-loss safety — there is no separate "enforce off" pass.

## Recovery checklist

1. **Read the fault** in the dashboard (the controller's status tile shows state + last fault).
2. **Clear the physical cause** — restore source level, clear a blockage, fix a stuck valve.
3. **Reset faults** from the dashboard to leave FAULT.
4. For a stuck valve, use **Manual control** to drive it (it releases on its own if your connection drops), or the per-valve coils for a bench test.
5. If a controller is offline, check power and network first — a controller with no server connection still enforces every on-device safety rule and resumes publishing when it reconnects.
