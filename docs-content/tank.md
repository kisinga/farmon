---
slug: tank
title: Tanks
category: node
order: 0
---

This site has **{{node_kind_count}} tank(s)**. A level-monitored tank uses an analog pressure sensor at the bottom to read water-column height; see **Pressure Sensor Calibration** for how the level is derived.

- Mount the sensor at the **lowest point** and set **Cal Empty / Cal Full** from the dashboard.
- A tank reading is **disturbed while the pump runs** (pressure artifacts), so the controller trusts it when idle and ignores it during a run. Mark the sensor **pump-safe** only when it is hydraulically decoupled from the pump (e.g. mounted on the tank itself); that keeps it trusted during a run so the route can stop on tank-full or source-low.
- A mechanical **float valve at every destination inlet is required** — it is overflow protection independent of the controller, and the flow drop when it closes is how MajiFlow detects "destination full". Size it to close against the pump's shut-off head and match the inlet pipe size.
