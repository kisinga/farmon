# Tunable defaults

A pattern used throughout MajiFlow for any setting that needs both a sensible value at install time and live adjustment at runtime.

## The two views of one value

| View | What it is | Where it's set |
|------|------------|----------------|
| **Default** | The value the device ships with — used at first boot, factory reset, and as a fallback if the live value is missing. | Editor (topology JSON / sidebar inputs). |
| **Live value** | The value the device is using right now. Persisted across reboots in NVS. | Tuned live from the dashboard (writes the device's `number:` entity over MQTT). |

The default seeds the live value via ESPHome's `initial_value` when the entity is created. After that, the operator's live changes win and stick (`restore_value: true`).

## Where this pattern is used

- Per-route `Max Runtime`, `Source Min Level`, `Dest Max Level` — set in the editor's *Route Overrides* sidebar, tuned live from the dashboard.
- Device-wide timing (`Flow Watchdog`, `Flow Confirm`, `Flow Threshold`, `Valve Travel Time`) — set in the editor's *Config* tab, tuned live from the dashboard.
- Per-sensor calibration on pressure sensors (`Sensor Min/Max`, `Cal Empty/Full`) — derived from tank dimensions plus `sensor_max_psi`, tuned live from the dashboard.
- Per-valve travel time — derived from device timing, tuned live per valve.

## What this means in practice

- **Changing a value at install time:** edit the field in the editor, deploy. The device boots with the new default and its live value is seeded from it (only on first boot or after entity reset).
- **Changing a value at runtime:** edit the value from the dashboard. The change applies immediately and persists across reboots.
- **Resetting to factory:** clear the persisted value (or reflash with NVS wipe). The device falls back to the default from the firmware.
- **A flashed default change does not overwrite a previously-persisted live value.** ESPHome's NVS is keyed by entity id, not by `initial_value`. Operators keep their tuning across deploys.

## Editor labels

Editor inputs that participate in this pattern read as "Default …" or carry hint text "*Initial value — adjust live from the dashboard*". The hint is the contract: this is the seed, the live value lives on the device and is tuned from the dashboard.
