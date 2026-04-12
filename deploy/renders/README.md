# MajiFlow — Reference Images

Visual reference for MajiFlow-generated water systems and the design tool.

---

## Topology Renders

### Home Pump Model

![Home pump model](home%20pump%20model.svg)

A reference topology showing a two-tank residential pump system with four motorized valves, three flow sensors, and two distribution endpoints. Used as the default example in documentation and presentations.

### X6 Canvas Render

![X6 canvas render](x6%20render.png)

Screenshot of the MajiFlow topology editor (AntV X6 canvas) showing nodes, pipes with Manhattan routing, and port connections. Demonstrates the visual design language used in the app.

---

## Planned Diagrams

| Diagram | Target Doc | Description |
|---------|-----------|-------------|
| `state-machine.svg` | Generated docs (Firmware Safety) | IDLE / PREPARING / RUNNING / STOPPING / FAULT state transitions |
| `deploy-stack.svg` | `deploy/README.md` | Service architecture (Pi + containers + network) |
| `safety-layers.svg` | Generated docs (Firmware Safety) | Layered safety model: pre-flight, flow watchdog, runtime, float switch |
| `route-anatomy.svg` | Generated docs (Routes) | Anatomy of a route: source → valves → pump → flow sensor → dest |
