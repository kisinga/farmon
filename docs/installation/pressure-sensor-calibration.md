# Pressure Sensor Calibration

A pressure sensor mounted at the bottom of a tank — or on the pipe leading from
its outlet — can be used as a tank-level reading. The firmware exposes four
calibration values per pressure sensor as Home Assistant `number` entities so
sensors can be swapped or recalibrated without reflashing.

## How a pressure sensor reads tank level

When a sensor sits below a primed water column, it reads the pressure exerted
by that column at its location:

```
P = ρ · g · h
```

For water at room temperature, ρ ≈ 1000 kg/m³ and g ≈ 9.81 m/s², so a 1 m
column of water exerts approximately **0.0981 bar** (or 9.81 kPa).

If the sensor is mounted at the same height as the tank's base, the pressure
reading scales linearly with how full the tank is. If the sensor sits *below*
the tank (e.g. at ground level while the tank stands on a platform), the pipe
between the two is full of water once primed, so the sensor reads a non-zero
pressure even when the tank is empty — the static head from the elevation
difference. That offset is constant and just shifts the calibration window.

## The four calibration entities

Each pressure sensor exposes these `number` entities in HA, all under
`entity_category: config`:

| Entity                 | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| **Sensor Min (bar)**   | Bottom of the sensor's electrical range (datasheet)           |
| **Sensor Max (bar)**   | Top of the sensor's electrical range (datasheet)              |
| **Cal Empty (bar)**    | Reading when this tank is empty (= elevation offset)          |
| **Cal Full (bar)**     | Reading when this tank is full (= elevation + water depth)    |

The first two define the voltage→pressure mapping (sensor-spec) and let you
swap to a different-range sensor without a reflash. The second two define the
pressure→level% mapping for *this specific install* and let you recalibrate
when geometry changes.

The derived `Tank Level (%)` sensor is computed at runtime as:

```
level_pct = clamp((pressure - cal_empty) / (cal_full - cal_empty) * 100, 0, 100)
```

## Worked example

A 5 m tall tank stands on a 2 m platform. The pressure sensor sits on the
ground, plumbed into the tank's outlet via a primed pipe.

- **Elevation offset:** sensor → tank base = 2 m of water column = 2 × 0.0981
  ≈ **0.196 bar**.
- **Full water depth:** tank height = 5 m = 5 × 0.0981 ≈ **0.491 bar**.
- **Cal Empty:** 0.196 bar (sensor reading with the tank empty but pipe primed).
- **Cal Full:** 0.196 + 0.491 ≈ **0.687 bar**.

If the installed sensor is rated 0–10 bar, **Sensor Min** = 0 and **Sensor
Max** = 10.

## Recalibration procedure

The cleanest calibration is empirical:

1. **Empty:** drain the tank fully (pipe stays primed). Read the live pressure
   value, enter it as **Cal Empty**.
2. **Full:** fill the tank to its working maximum. Read the live pressure
   value, enter it as **Cal Full**.

If draining / filling isn't practical, compute the values from the formula
above and enter them directly — accuracy depends on knowing the elevation and
water-depth dimensions to within a few centimetres.

## When to replace the sensor

If the sensor's electrical range changes (e.g. swapping a 0–10 bar transducer
for a 0–4 bar one), update **Sensor Min** and **Sensor Max** to match the new
datasheet values. The Cal Empty / Cal Full entries do not need to change unless
the plumbing geometry also changed.
