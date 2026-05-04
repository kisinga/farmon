<!-- generated from packages/core/src/templates/pages/docs/installation/deployment.hbs — do not edit -->
# Deployment

## 1. Regenerate

```sh
npm run generate
```

This refreshes the ESPHome firmware YAML *and* the Home Assistant dashboards / automations from the current topology. Always run this after any manifest change.

## 2. Flash firmware

Required when any pin assignment, board, peripheral, route, automation logic, or substitution changes. Skip when only HA-side files (dashboard.yaml, automations/*.yaml) changed.

```sh
esphome run esphome/<device>/<device>.yaml
```

> First flash **must** be over USB. Subsequent flashes can be OTA via the ESPHome dashboard or `esphome run --device <ip>`.

## 3. Copy HA files

```sh
cp -r config/homeassistant/* /path/to/homeassistant/
```

Then reload Home Assistant (Developer Tools → YAML → "All YAML configuration") or restart the HA service.

## 4. Verify

- Open the dashboard. Every entity card should resolve (no "entity not found").
- The cross-validation test (`npm run test:entity-coverage`) is the codegen-time guard — failures here mean the dashboard would show broken cards, so fix before deploying.

---

## First-time pairing (when device is new to HA)

After the first flash:

1. Power-cycle the controller.
2. In HA, **Settings → Devices & Services → Add Integration → ESPHome**.
3. Enter the device's IP or hostname. The API key is in `secrets.yaml`.
4. Entities appear via autodiscovery; no manual entity registration is needed.

## ⚠️ Friendly name changes — entity_id stickiness

If you change a controller's friendly name, the firmware emits entities under a new prefix (`<domain>.<slug(new_name)>_*`), but Home Assistant does **not** rename the existing entity_ids in its registry. Result: the new dashboards reference the new prefix; the old entities go to "unavailable"; you see "entity not found" everywhere.

**Two ways out:**

1. **Adopt the new name:** delete and re-pair the device in HA (Settings → Devices & Services → ESPHome). Autodiscovery creates the new entities; remove the old ones from the entity registry.
2. **Revert:** set the friendly name back to whatever HA already has (visible in HA's entity registry) and redeploy.

The editor's config tab shows a warning banner when a friendly-name change is detected — follow the link there to this section.

## Renamed nodes

When you rename a node (level sensor, valve, pump, etc.), the firmware emits its entity under a new entity_id. HA's old entry persists as "unavailable" until manually removed via the entity registry.

---

## Manual control (HA "Manual" tab)

Each controller's Home Assistant dashboard has a **Manual** tab exposing the operator-facing controls: `Safety Override`, the pump switch, per-valve `Cover` + `Open Coil` + `Close Coil`, and per-route Start / Stop buttons. The semantics:

- **Safety Override** — single global bypass. While ON, pre-start gates (source-low, dest-full) are skipped, the runtime watchdog (flow, max-runtime, API) is suppressed, and the pump can be turned on without an owning route. Reverts to OFF on reboot. Use for commissioning and recovery only.

- **Cover** — the safe way to operate a valve manually. Timer-bounded, the same path the routing layer uses. You can open or close any valve at any time, with or without an active route — the route-level reconciler does not fight manual cover writes for valves it isn't claiming.

  Closing a cover *during* a running route does **not** stop the route. The reconciler does not read cover state, only writes it; an externally-driven close goes unnoticed and the route loses flow until the flow watchdog faults it after `flow_watchdog_ms`. **Use the route Stop button to halt a running route**, not manual cover close.

- **Open / Close coils** — diagnostic. They drive the coil GPIO directly, bypassing the cover's `open_action` / `close_action`, so the cover's internal position estimate does not update. The hardware interlock prevents both coils from being energised simultaneously, but no firmware gate prevents firing during a route. Use coils only for bench tests and stuck-valve recovery; after firing one, call `cover.stop_cover` on the same valve to resync the cover's position.

- **Pump** — direct on/off. Without an owning route, the pump's `on_turn_on` handler immediately turns it back off — unless `Safety Override` is ON. This means there is no way to spin up the pump alone for testing without flipping the override first; that is intentional.

The Manual tab is a separate Lovelace view per controller (`<friendly_name> Manual`) and is generated automatically from the topology. There is also a **Configuration** tab per controller exposing all `number:` config entities (watchdogs, route max runtimes, valve travel times, level/pressure calibration).

---

## Float valves at every tank inlet

A mechanical float valve at every tank inlet is a hard requirement, not an optional accessory. The controller's tank-full detection assumes one is present. Three reasons:

1. **Passive overflow protection.** The valve closes regardless of controller state. If the controller crashes, a sensor mis-reads, or a route command misfires, the float still stops the inflow before the tank overflows. No firmware path can replace this — it is the safety layer of last resort.

2. **Tank-full signal via flow differential.** When a destination tank fills, its float closes and the source flow rate drops. The flow watchdog and the per-route `dest_max_pct` level threshold both depend on this behaviour to detect "destination full." Without a float, upstream flow cannot distinguish "destination full" from any other back-pressure cause (a partly closed valve, a kinked hose, a stuck pump check valve), so the controller would either keep filling forever or false-trigger on unrelated flow loss.

3. **Safe parallel filling.** A single pump can serve multiple tanks at once. When one tank fills first, its float closes and water naturally redirects to the others. The differential flow rate the controller observes — total demand minus the share absorbed by closed-float tanks — gives a usable approximation of which tanks are still drawing.

**Selection guidance.** The float valve must close fully against the pump's shut-off head (not just static head); use the pump curve when sizing. Match the valve to the inlet pipe size; under-sized valves cavitate and chatter. Mount the float at the desired maximum fill level with enough swing arm clearance that surface ripples do not cause it to oscillate.

See also: [Pressure sensor calibration](pressure-sensor-calibration.md) for the level-sensing companion to this overflow protection, and the flow watchdog in `electron/lib/generators/control.ts` for the firmware that consumes the differential-flow signal.

---

## Common deploy patterns

| Change | Regenerate | Flash | Reload HA |
|--------|:---:|:---:|:---:|
| Pin reassignment, new sensor, new route | ✓ | ✓ | ✓ |
| Dashboard layout, automation schedule | ✓ |   | ✓ |
| Friendly-name change | ✓ | ✓ | ✓ + entity registry cleanup |
| Adding a new controller | ✓ | ✓ (USB) | ✓ + ESPHome integration pairing |

---

## See also

- [Power and wiring](power-and-wiring.md)
- [KC868-A16 board guide](kc868-a16.md)
- [Glossary](../glossary.md)
