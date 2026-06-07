---
slug: flow_sensor
title: Flow Sensors
category: node
order: 0
---

This site has **{{node_kind_count}} flow sensor(s)**. A flow sensor is the controller's eyes on a route: it confirms flow within {{flow_confirm}} s of a start, and a sustained drop below {{flow_threshold}} L/min for {{flow_watchdog}} s trips the no-flow fault (or signals a full destination).

- **Placement — the 10D/5D rule:** 10 pipe diameters of straight pipe upstream, 5 downstream. For 25 mm pipe that's 250 mm before, 125 mm after.
- Mount horizontally with the impeller axis vertical; the arrow follows flow direction.
- Use shielded cable for runs over 2 m and keep it clear of mains conduit — induced noise corrupts pulse counts.
