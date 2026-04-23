# farm-scada-card

A Home Assistant custom card that renders [MajiFlow](../core) topologies as live SCADA views: entity states map to CSS classes, long-press/right-click opens per-node menus, text labels bind to live values, and pipes animate when their source entity is on.

## Install (HACS custom repository)

1. HACS → Frontend → ⋮ → Custom repositories
2. Add this repo URL, category: Lovelace
3. Install "MajiFlow SCADA Card"
4. Reload your dashboard

## Produce artifacts

In the MajiFlow editor, click **Generate HA** on the deploy page. Two files per device land under `<output>/config/homeassistant/www/farm/`:

- `<device>.svg` — decorated SVG (schema v1)
- `<device>.meta.json` — entity mappings, actions, bind expressions

Bind-mount that directory into your HA container at `/config/www/`.

## Use in a dashboard

```yaml
type: custom:farm-scada-card
title: Greenhouse
source: /local/farm/greenhouse.svg
meta: /local/farm/greenhouse.meta.json
# optional
height: 520
viewbox: [0, 0, 1200, 600]
default_actions:
  - id: more-info
    label: More info
actions_override:
  switch.pump_1:
    - id: more-info
      label: More info
    - id: run-3min
      label: Run 3 minutes
      service: script.pump_timer
      data: { seconds: 180 }
      confirm: true
```

## Contract version

Card supports artifact schema **v1**. Mismatches surface as a visible error in the card.
