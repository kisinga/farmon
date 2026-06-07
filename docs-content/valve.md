---
slug: valve
title: Valves
category: node
order: 0
---

This site has **{{node_kind_count}} valve(s)**. MajiFlow's default is a **2-wire motorized valve**: the controller energizes an OPEN or CLOSE motor for up to **{{valve_travel_time}} s** of travel, then the valve mechanically latches and draws no current.

- Wire one pair per valve straight from the controller — never daisy-chain valve power.
- The two coils are hardware-interlocked: OPEN and CLOSE can never energize at once.
- Closing a valve by hand during a running route does **not** stop it — use the route **Stop** button; otherwise the flow watchdog faults the route once flow drops.
- Mount horizontally, or with the actuator above the pipe.
