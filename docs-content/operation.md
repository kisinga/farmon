---
slug: operation
title: Operation
category: narrative
node_kind: 
order: 10
---

For the site operator — what each controller does day to day, the controls you'll see in the MajiFlow dashboard, and the safety rules that protect your equipment. Applies regardless of the application (irrigation, hotel, greenhouse, commercial water plant).

## Controls in the dashboard

Each controller publishes its state to the server over MQTT; you drive it from the site dashboard:

- **Route Start / Stop** — start or stop a configured path from a source to a destination. Start runs the pre-flight checks first; Stop sequences a clean shutdown. A route can carry a **stop target** (a litre volume or a run time) that ends the run cleanly on its own.
- **Stop all / Reset faults / Clear queue** — per-controller commands. **Reset faults** returns a latched controller to IDLE after you've cleared the cause.
- **Automations** — start a route by schedule (a time of day on chosen weekdays) or by tank level, without anyone at the dashboard. Automated runs pass the same safety checks as a manual Start. See **Automations**.
- **Manual control** — hold an actuator (pump or valve) open while you watch it. It is leased: if your connection drops, the device releases it on its own (the dead-man lease), so nothing is left running by accident.
- **Tank calibration** — set each level-monitored tank's empty / full calibration from the dashboard number controls.
- **Safety Override** — a single global bypass. While ON, every runtime safety check is skipped and the pump may run without an owning route. It reverts to OFF on reboot. Use it only for commissioning and recovery.

## Timing parameters

These are site-wide and tunable; the firmware bakes them and the dashboard reflects them:

| Parameter | Value | Meaning |
|---|---|---|
| Valve travel time | **{{valve_travel_time}} s** | Time allowed for a valve to fully open or close |
| Flow watchdog | **{{flow_watchdog}} s** | No-flow duration before a fault / tank-full detection |
| Flow confirm | **{{flow_confirm}} s** | Time to confirm flow is established after a start |
| Flow threshold | **{{flow_threshold}} L/min** | Minimum measured rate that counts as active flow |
| Sensor update | **{{update_interval}} s** | ADC / sensor polling interval |

## Safety at a glance

- **Pre-start checks** — source / destination level thresholds are enforced before every start.
- **Flow watchdog** — a no-flow fault after {{flow_watchdog}} s; flow must be confirmed within {{flow_confirm}} s.
- **Runtime level** — on routes with pump-rated level sensors, the run stops cleanly when the threshold is reached.
- **Safety Override** — while ON, every check above is skipped and the pump may run without an owning route. Reverts to OFF on reboot.

All of this logic runs **on the controller itself**, not the server — a lost connection never disables a safety check.
