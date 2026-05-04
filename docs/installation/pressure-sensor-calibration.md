# Pressure Sensor Calibration

A pressure sensor mounted on a tank's outlet pipe can be used as a tank-level reading. The editor takes the tank's physical dimensions, derives the calibration values from first principles, and seeds them into Home Assistant. Installers do not enter pressure values directly; they enter geometry and the math runs centrally.

## How a pressure sensor reads tank level

A sensor plumbed into the tank's outlet sees the pressure of the water column standing above it:

```
P [psi] = 1.4223 · h [m]
```

(ρ·g·h with ρ = 1000 kg/m³ and g = 9.81 m/s², converted from Pa to psi.)

The controller typically sits low — next to the pump — and the tank sits above. The vertical pipe between the tank's bottom outlet and the sensor stays full of water once the system is primed (the sensor is the lowest point, water cannot drain upward), so the sensor reads a non-zero pressure even when the tank is empty. That offset depends only on the **elevation** — the vertical drop from tank bottom to sensor — and is constant.

## Inputs the editor asks for

| Input | Unit | Meaning |
| --- | --- | --- |
| Tank height | m | Vertical span of water column inside the tank |
| Tank capacity | L | Usable volume — drives the litre readout |
| Sensor drop below tank | m | Vertical distance from tank bottom to sensor |
| Sensor max | psi | The transducer's full-scale rating from its datasheet |

## What the editor derives

```
P_empty [psi] = 1.4223 · elevation
P_full  [psi] = 1.4223 · (elevation + tank_height)
```

These seed two of the four runtime-tunable Home Assistant `number` entities each pressure sensor exposes (all under `entity_category: config`):

| Entity                 | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| **Sensor Min (psi)**   | Bottom of the sensor's electrical range (datasheet)           |
| **Sensor Max (psi)**   | Top of the sensor's electrical range (datasheet)              |
| **Cal Empty (psi)**    | Reading when this tank is empty (= elevation offset)          |
| **Cal Full (psi)**     | Reading when this tank is full (= elevation + water depth)    |

The first two define the voltage→pressure mapping (sensor-spec) and let installers swap to a different-range sensor without a reflash. The second two define the pressure→level% mapping for *this specific install* and let installers recalibrate when geometry changes — the seeded values are accurate to within a few percent if the geometry is entered correctly.

The derived `Tank Level (%)` sensor is computed at runtime as:

```
level_pct = clamp((pressure - cal_empty) / (cal_full - cal_empty) * 100, 0, 100)
```

## Worked example

A 5 m tall tank stands on a 2 m platform; the sensor sits at the pump near ground level, 2 m below the tank bottom.

- **P_empty** = 1.4223 × 2 ≈ **2.84 psi** (sensor reading with the tank empty but pipe primed)
- **P_full** = 1.4223 × (2 + 5) ≈ **9.96 psi**
- **Working span** = 9.96 − 2.84 = 7.11 psi
- **Recommended sensor max** ≥ 1.5 × 9.96 ≈ 14.9 psi → **15 psi** is the smallest standard size that fits
- A 15 psi sensor uses 7.11 / 15 ≈ **47%** of its range for the tank fill, with **34%** headroom above full — comfortable on both axes.

## Tank-shape assumption

Pressure-derived level is linear **only when the tank's horizontal cross-section is constant with height**. Tanks that satisfy this:

- Vertical cylindrical tanks (the most common case)
- Rectangular / cubic tanks
- Any prismatic tank with a constant footprint

Tanks that do **not**:

- Horizontal cylindrical tanks — error grows toward the middle, peaking around ±21 % at the 50 % mark
- Conical tanks (water-tower style) — error grows toward the wide end
- Spherical tanks — large error band across most of the range
- Irregular / hand-built tanks — no general guarantee

If your tank is not regular, three options:

1. **Accept the error** if the installation only needs coarse "low / mid / high" indication.
2. **Use a level sensor instead** of a pressure sensor — a float, an ultrasonic distance sensor, or a strain gauge. Each gives a more direct reading on irregular tanks.
3. **Build a custom lookup table** mapping pressure to volume for your specific shape — out of scope for this calibration UI.

## Recalibration procedure

If the seeded values disagree with reality (because tank dimensions were estimated, or geometry changed after install), the cleanest correction is empirical:

1. **Empty:** drain the tank fully (pipe stays primed). Read the live pressure value and overwrite **Cal Empty**.
2. **Full:** fill the tank to its working maximum. Read the live pressure and overwrite **Cal Full**.

If draining or filling is not practical, recompute from the formula above and edit the values directly. Accuracy depends on knowing the elevation and water-depth dimensions to within a few centimetres.

## When to replace the sensor

If the sensor's electrical range changes (e.g. swapping a 0–15 psi transducer for a 0–30 psi one), update **Sensor Min** and **Sensor Max** to match the new datasheet values. The Cal Empty / Cal Full entries do not need to change unless the plumbing geometry also changed.
