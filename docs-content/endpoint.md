---
slug: endpoint
title: Endpoints
category: node
order: 0
---

This site has **{{node_kind_count}} endpoint(s)** — a terminal consumer such as a building, irrigation zone, hose bib, or distribution manifold.

- An endpoint has inlet(s) only and no level sensor; it consumes water rather than storing it, so it's the end of a route, never a source.
- Because there's no level to gate on, a route into an endpoint is bounded by its **max runtime** and the flow watchdog, not a destination-full threshold.
- Fit a float valve or downstream control if the endpoint can back up (e.g. a small buffer tank serving a zone).
