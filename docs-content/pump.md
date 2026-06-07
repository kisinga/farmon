---
slug: pump
title: Pumps
category: node
order: 0
---

This site has **{{node_kind_count}} pump(s)**. The controller relay never carries pump current — it switches a **contactor coil**, and the contactor switches the pump. The contactor is the field-replaceable wear part.

- A pump only runs while an active route owns it; running it without an owning route is blocked unless **Safety Override** is ON (commissioning only).
- Above 0.5 HP needs a contactor; 1.5 HP+ a soft-starter or VFD; 2 HP / 3-phase runs on a VFD over RS485/Modbus, off the relay path.
- Always fit a thermal overload and dry-run protection. See **Power & Wiring** for branch sizing.
