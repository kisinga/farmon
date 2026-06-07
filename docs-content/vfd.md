---
slug: vfd
title: Variable-Frequency Drives
category: node
order: 0
---

This site has **{{node_kind_count}} VFD-driven pump(s)**. A variable-frequency drive replaces the relay-and-contactor path for large or 3-phase pumps: the controller commands it over **RS485 / Modbus** instead of switching a coil.

- Use a VFD for pumps at 2 HP and up, or any 3-phase pump — DOL inrush there is outside the relay path entirely.
- The VFD ramps the motor, so it collapses inrush to ~1.2–1.5× full-load current and spares the supply.
- Wire the RS485 pair to the controller's Modbus bus; address and registers come from the VFD's manual.
