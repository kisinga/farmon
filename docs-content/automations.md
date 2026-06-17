---
slug: automations
title: Automations
category: narrative
order: 15
---

For the site operator. An automation starts a route by itself: at a set time, or when a tank rises to a level you choose. You build them from the **Automations** page (or the dashboard's Automations panel); no engineer and no re-flash is needed.

## What an automation is

Each automation ties one **route** to one **trigger** and an optional **stop target**. When the trigger fires, the controller starts that route exactly as if you had pressed **Start**: every pre-flight and runtime safety check still applies. An automation can only start a route that safety would already allow; it never bypasses a check.

The rules run **on the controller**, not the server. Once saved they keep firing through a server or internet outage, and a saved edit reaches the device within seconds. A site holds up to **32** automations.

## Triggers

- **Time** — fire at a time of day on the days you pick (any combination of weekdays, or every day). Time triggers wait for the controller to get a real clock from the network; they will not run off a rough estimate after a cold boot. Each one fires once for its day and time.
- **Level** — fire when the route's **source tank** rises to your threshold percent. It re-arms after the tank falls back below, so a tank hovering at the line does not start the route over and over.

## Stop targets

By default an automated run stops on the same conditions as a manual one (destination full, source low, the route's max runtime). You can also give an automation its own ceiling for that run:

- **Target volume** — stop cleanly once the route's flow sensor has passed a set number of litres.
- **Target time** — stop cleanly after a set run duration.

Whichever target is reached first ends the run. These are clean stops, not faults. You can set the same per-run overrides (source-low and destination-full thresholds, max runtime) on an automation without changing the route's own defaults.

## Good practice

- Point a level trigger at a tank that is actually on the route's source side; that is the level the controller watches.
- Give every automated route a max runtime even when you also set a volume or time target. The runtime is the safety backstop if a target is never reached.
- A run started by an automation is labelled as such in the dashboard's activity timeline, so you can tell automated starts from manual ones.
