<!-- generated from packages/core/src/templates/pages/docs/glossary.hbs — do not edit -->
# MajiFlow — Glossary

Canonical definitions for the water system topology model. All code, config files, and UI must use these terms consistently.

## Physical Entities

**Node** — A physical entity with named ports. Three types: Tank, Pump, Endpoint.

**Tank** — Water storage container with a level sensor (ADC pin). Has inlet and outlet ports. Tanks are both sources (water leaves via outlet) and destinations (water arrives via inlet).

**Pump** — Single relay-controlled water pump. Has exactly one inlet and one outlet. All pressurized (non-gravity) paths traverse the pump.

**Endpoint** — A non-tank destination such as a building, irrigation zone, hose bib, or distribution manifold. Has inlet port(s) but no level sensor. Unlike tanks, endpoints consume water — they are terminal nodes in the graph.

## Connections

**Port** — A connection point on a node. Has a direction: `inlet` (water enters) or `outlet` (water leaves). Ports are purely physical — they carry no operational config. A tank can have multiple ports (e.g., separate inlets from different sources).

**Pipe** — A directed connection from an outlet port to an inlet port. Represents physical plumbing between two nodes. Pipes carry inline components (valves, sensors) in order along their length.

## Inline Components

**Valve** — A motorized ball valve installed inline on a pipe. Controlled by two GPIO pins (open/close). Determines whether water can pass through the pipe it sits on.

**Flow Sensor** — A pulse-counter sensor installed inline on a pipe. Measures water flow rate (L/min). Every pumped path requires exactly one flow sensor for safety monitoring.

## Derived Concepts

**Route** — A path through the topology graph from a source tank to a destination (tank or endpoint). Routes are **computed by traversing the graph**, never manually defined. A route includes: the source tank, destination node, all valves along the path, the flow sensor, and operational overrides (name, max runtime).

**Passive Path** — A path through the graph that does not cross the pump node (e.g., gravity-fed). Passive paths are visualized but do not generate pump routes. Flow sensors on passive paths still generate monitoring configs.

## Data Structures

**Topology** — The complete directed graph: nodes, pipes, inline components, route overrides, and timing config. This is the source of truth for the system design. Schema version 3.

**Manifest** — The flat data structure consumed by the codegen pipeline. Contains tanks, pump, valves, flow sensors, routes, and timing as separate arrays. Derived from the topology via `topologyToManifest()`. The codegen pipeline never sees the topology directly.

**Route Override** — User-specified operational config for a derived route, keyed by `"sourceId>destId"`. Contains optional route name and max runtime in seconds. Stored at the topology level, not on individual nodes or ports.
