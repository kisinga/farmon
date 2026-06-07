---
slug: water_source
title: Water Sources
category: node
order: 0
---

This site has **{{node_kind_count}} water source(s)** — an always-available supply such as mains, a borehole, or a river feed. Unlike a tank it has no stored level; routes treat it as an inexhaustible origin.

- A source has an outlet only; water leaves toward a tank or endpoint.
- Source-side pre-start level gates don't apply — only the flow watchdog protects a run.
- If the supply can fail (mains cut, dry borehole), the flow watchdog faults the no-flow run.
