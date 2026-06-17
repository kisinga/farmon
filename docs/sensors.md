# Sensors and Pump Operation

This page explains the mental model behind sensor placement in MajiFlow and what the `Reading reliable while pump runs` flag actually means.

## Two physical placements

A sensor sits in exactly one of two ways:

- **Tank-mounted** — physically attached to the tank. Reads the static head of the fluid column inside the tank. Pump activity elsewhere does not change what it reads.
- **Inline** — sitting on a pipe segment. Reads whatever pressure exists at that point in the line. When a pump is moving water through that pipe, friction and suction draw shift the reading away from the source pressure.

## How this maps onto sensor kinds

| Kind            | Tank-mounted? | Inline? | Notes |
|-----------------|---------------|---------|-------|
| Level sensor    | Always        | Never   | A level sensor only makes sense on a tank. It is intrinsically pump-safe, so it carries no flag. |
| Pressure sensor | Possible      | Possible| Same physical part can be plumbed either way. The `Reading reliable while pump runs` toggle records which case the installer wired. |
| Flow sensor    | Never         | Always  | Flow only happens in pipes. |

## What the pressure-sensor flag means

`Reading reliable while pump runs` (internally `pump_rated`) is a placement flag, not a hardware spec.

- Toggle **on** when the pressure sensor is mounted on a tank (or otherwise hydraulically decoupled from the pump's flow path). The reading stays accurate while the pump runs, so runtime level checks consume it.
- Leave **off** when the pressure sensor sits inline on a pipe near a pump. The reading is disturbed during pump operation, and runtime level checks for routes that cross the pump are suppressed for that sensor.

The firmware uses this per-route: a route that does not cross a pump always trusts the reading. A route that crosses a pump trusts it only when both ends' level sources are pump-safe.

## Tank dimensions

`Tank height (m)` and `Tank capacity (L)` live on the tank itself. When a pressure sensor downstream of a tank is used as that tank's level source, calibration (`Cal Empty`, `Cal Full`) is derived automatically from the tank's height plus the sensor's `Sensor drop below tank (m)`.

For pressure sensors used purely for line-pressure monitoring (no upstream tank in their path), tank dimensions are irrelevant and `Cal Empty` / `Cal Full` start at 0 / sensor max — adjust them live from the dashboard if needed.
