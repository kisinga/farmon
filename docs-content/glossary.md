---
slug: glossary
title: Glossary
category: glossary
order: 90
---

Canonical definitions for the water-system model. Code, config, and UI use these terms consistently.

**Node** — A physical entity with named ports (tank, pump, valve, flow sensor, water source, endpoint, filter, dosing pump, VFD).

**Tank** — Water storage with a level sensor. Has inlet and outlet ports; acts as both source and destination.

**Pump** — A relay- (or VFD-) controlled pump. Exactly one inlet and one outlet. Every pressurized (non-gravity) path traverses a pump.

**Endpoint** — A non-tank destination (building, irrigation zone, hose bib, manifold). Inlet only, no level sensor — it consumes water, so it's terminal.

**Water source** — An always-available supply (mains, borehole, river). No stored level.

**Port** — A connection point on a node, directional: `inlet` (water enters) or `outlet` (water leaves). Purely physical — carries no config.

**Pipe** — A directed connection from an outlet to an inlet. Carries inline components (valves, sensors) in order along its length.

**Valve** — A motorized valve inline on a pipe, driven by two pins (open/close). Gates whether water passes.

**Flow sensor** — A pulse-counter inline on a pipe, measuring rate (L/min). Every pumped path needs exactly one for safety monitoring.

**Route** — A path from a source to a destination, **computed by traversing the graph**, never hand-defined. Includes the source, destination, valves on the path, the flow sensor, and overrides (name, max runtime).

**Passive path** — A graph path that does not cross a pump (e.g. gravity-fed). Visualized but generates no pump route; flow sensors on it still publish monitoring.

**Topology** — The complete directed graph (nodes, pipes, inline components, overrides, timing). The single source of truth for the design.
