---
slug: pressure-calibration
title: Pressure Sensor Calibration
category: narrative
order: 70
---

A pressure sensor on a tank's outlet pipe reads tank level. Installers enter **geometry**, not pressure — the editor derives the calibration and seeds it into the dashboard's number controls.

## How it reads level

A sensor plumbed into the outlet sees the pressure of the water column above it:

```
P [psi] = 1.4223 · h [m]      (ρ·g·h, water, converted Pa → psi)
```

The controller usually sits low (by the pump) with the tank above. The vertical pipe from tank bottom to sensor stays primed, so the sensor reads a constant non-zero pressure even when the tank is empty — an offset that depends only on the **elevation** (drop from tank bottom to sensor).

## Inputs the editor asks for

| Input | Unit | Meaning |
|---|---|---|
| Tank height | m | Vertical span of the water column |
| Tank capacity | L | Usable volume — drives the litre readout |
| Sensor drop below tank | m | Vertical distance from tank bottom to sensor |
| Sensor max | psi | The transducer's full-scale rating (datasheet) |

## What it derives

```
P_empty = 1.4223 · elevation
P_full  = 1.4223 · (elevation + tank_height)
```

These seed the per-sensor dashboard number controls:

| Control | Meaning |
|---|---|
| **Sensor Min / Max (psi)** | The transducer's electrical range (datasheet) — swap to a different-range sensor without a reflash |
| **Cal Empty (psi)** | Reading when this tank is empty (= elevation offset) |
| **Cal Full (psi)** | Reading when this tank is full (= elevation + depth) |

`Tank Level (%)` is then `clamp((pressure − cal_empty) / (cal_full − cal_empty) · 100, 0, 100)`.

## Worked example

A 5 m tank on a 2 m platform, sensor at the pump 2 m below the tank bottom:

- **P_empty** = 1.4223 × 2 ≈ **2.84 psi**
- **P_full** = 1.4223 × 7 ≈ **9.96 psi**
- **Recommended sensor max** ≥ 1.5 × 9.96 ≈ 14.9 → **15 psi**, using ~47 % of its range with comfortable headroom.

For elevated tanks, check the utilisation: a high empty-pressure with a small fill swing gives poor resolution even when the range is safe. Use a lower-range protected sensor or move the sensing point.
