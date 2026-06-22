---
slug: maintenance
title: Maintenance
category: narrative
node_kind: 
order: 25
---

For the site operator: a short, recurring routine that keeps {{site_name}} running and keeps your warranty valid. You can do everything here yourself, with no special tools, up to the point where live electrical work begins (see **When to call a professional** below).

Your system today: {{controller_count}} controller(s), {{tank_count}} tank(s), {{pump_count}} pump(s), {{valve_count}} valve(s), and {{flow_sensor_count}} flow sensor(s). Skip any task for equipment your site does not have.

## What MajiFlow watches for you

The controllers monitor continuously and raise an alert in the dashboard when something needs attention, so most upkeep finds you rather than the other way round:

- **Filter clogging.** A rising pressure difference across a filter is flagged before flow suffers. Clean or replace the cartridge when you see it.
- **No-flow faults.** If flow is not established within the configured window, the run faults safe (the {{flow_watchdog}} s watchdog). A repeated no-flow fault points at a dry source, a closed valve, or a failing pump.
- **Level and sensor anomalies.** Out-of-range tank levels and sensor readings are flagged.

Treat dashboard alerts as the first item on every visit.

## Monthly (a few minutes, no tools)

- Walk the line: look and listen at each pump for leaks, drips, or unusual vibration.
- Exercise valves that rarely move so they do not seize. Start a short run on each route, or open and close from the dashboard, and confirm each valve travels within {{valve_travel_time}} s.
- Glance at the filter pressure trend in the dashboard. A slow climb means a clean is due soon.
- If your site has solar panels, wipe them down when output drops.

## Quarterly (a short safety check)

- Confirm dry-run protection works: with the source isolated or empty, start a route and confirm the pump faults safe instead of running dry. Reset faults afterwards.
- Confirm the flow watchdog trips: a route with no flow should fault within {{flow_watchdog}} s.
- Open each controller enclosure (power off first), check for moisture, insects, or loose-looking wiring, then reseal it firmly.
- Apply any firmware or dashboard updates MajiFlow has published.

## Yearly

- Clean each tank: clear sediment, check for cracks, and confirm the level reading matches the real level (recalibrate empty and full if needed).
- Check flow-sensor accuracy against a known volume: fill a container of known litres and compare.
- Replace filter cartridges on a yearly floor, even if the pressure trend still looks healthy.
- For sites with a battery and solar hub, confirm the battery still holds its rated charge.

## When to call a professional

Stop at the panel door. Anything involving live mains or three-phase power is for a qualified electrician, not a self-service task:

- Replacing a pump contactor (the dashboard flags when its rated cycle count is near).
- Anything inside a VFD or inverter beyond cleaning its cooling vents with the power off.
- Re-torquing terminals on circuits that carry mains voltage.
- Borehole or pump mechanical work.

Live electrical work without the right qualification is unsafe and, under the MajiFlow warranty, is not covered. See **Warranty**.
