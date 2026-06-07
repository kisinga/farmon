---
slug: tank
title: Tanks
category: node
order: 0
---

This site has **{{node_kind_count}} tank(s)**. A level-monitored tank uses an analog pressure sensor at the bottom to read water-column height; see **Pressure Sensor Calibration** for how the level is derived.

- Mount the sensor at the **lowest point** and set **Cal Empty / Cal Full** from the dashboard.
- Tank readings are **suppressed while the pump runs** (pressure artifacts) and trusted when idle.
- A mechanical **float valve at every destination inlet is required** — it is overflow protection independent of the controller, and the flow drop when it closes is how MajiFlow detects "destination full". Size it to close against the pump's shut-off head and match the inlet pipe size.
