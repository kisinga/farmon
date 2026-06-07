---
slug: wiring-power
title: Power & Wiring
category: wiring
node_kind: 
order: 60
---

MajiFlow installations use **a single 12 V DC rail for everything controller-side**: the controller board, all solenoid valves, and all sensors share one supply. Mains (220–240 VAC, single-phase) is separate and only powers the pump, switched indirectly through a contactor.

One DC PSU. One mains feed. One contactor. That's the install.

## At a glance

| Item | Spec |
|---|---|
| DC supply | 12 V / 2 A regulated, 24 W (e.g. Mean Well RS-25-12) — sized for MajiFlow's default 2-wire motorized valves; direct-wired DC solenoid valves hold ~0.6 A each and need 12 V / 5 A |
| Mains supply | 220–240 VAC, 1φ, sized to pump |
| Pump switching | Controller relay → contactor coil → pump |
| Pump scale via relays | Up to 1.5 HP, 1φ, direct-on-line (DOL) |
| Larger / 3φ pumps | VFD via RS485/Modbus — separate path, no relay |
| Solenoid valves | 12 V DC only |

> Anything outside these envelopes (3φ pumps without a VFD, mixed valve voltages, > 2 HP DOL) is **expert-level** and beyond the scope of this guide. The parameter tables below still apply; sizing the install becomes the electrician's call.

## DC power supply (12 V rail)

The controller board, every 12 V DC solenoid valve, and every sensor draw from one 12 V supply.

### Sizing

MajiFlow's default valve type is a **2-wire motorized valve**: the controller energizes an OPEN or CLOSE motor for ~{{valve_travel_time}} s of travel, then the valve mechanically latches and draws zero current. Steady-state load is essentially just the board.

Concurrent valve activations are firmware-capped at 2 (briefly 3 during a route handoff). With motorized valves, worst-case demand is short and modest:

| Installation | Steady (no valves moving) | Peak (handoff: pump on + 2 motors traveling) |
|---|---|---|
| Any size, 1–8 valves | ~0.25 A | ~1.0 A for ~{{valve_travel_time}} s |

**One-line rule:** *A 12 V / 2 A regulated supply (24 W) covers any single-controller install with motorized valves. **Direct-wired DC solenoid valves are different — each holds ~0.6 A continuously while open, so an install with those needs 12 V / 5 A (60 W) instead.***

Use a **regulated** supply (SMPS), not an unregulated wall-wart. Motor start and any solenoid inrush will sag an unregulated 12 V brick below the ESP32's brown-out threshold.

## DC cable runs

For 12 V DC, **voltage drop is the binding constraint** — not current capacity. A 12 V solenoid pulls in at ≈ 10.2 V (85 % of nominal); during inrush, end-of-cable voltage must stay above this.

All lengths assume **copper conductor at 20 °C**, one-way distance from controller to load, sized for the inrush moment (the worst case).

### Controller → valve

One pair (live + return) per valve. Don't daisy-chain.

| Cable size | AWG (≈) | Max one-way length |
|---|---|---|
| 0.5 mm² | 20 | **15 m** |
| 0.75 mm² | 18 | **25 m** |
| 1.0 mm² | 17 | **35 m** |
| 1.5 mm² | 15 | **50 m** |
| 2.5 mm² | 13 | **85 m** |

> If two valves *must* share a common return wire, size the return one step up.

### Sensor cables

Use **shielded twisted pair**. Ground the shield at the controller end only.

| Sensor | Signal | Cable | Max length |
|---|---|---|---|
| Flow sensor (Hall pulse) | digital pulse, 5–12 V | shielded 2-pair, 0.34 mm² | **30 m** |
| Tank level (0–5 V analog) | analog | shielded twisted pair, 0.34 mm² | **20 m** |

Beyond these distances pulse counts get noisy and ADC readings drift. Mount the controller closer, or deploy a second controller as a remote node linked over the network.

## Mains and the pump (separate from the DC rail)

The controller relay does **not** carry pump current. It switches a **contactor coil**; the contactor switches the pump. This is true even for small pumps where the relay rating is technically sufficient — the contactor is the field-replaceable wear part.

### Contactor / VFD threshold

| Pump size | Switching | Why |
|---|---|---|
| ≤ 0.5 HP | Relay direct *permitted*, contactor still preferred | LRA ~12–15 A, within 10 A relay rating but degrading |
| > 0.5 HP | **Contactor required** | LRA exceeds relay rating |
| ≥ 1.5 HP | Contactor + soft-starter, *or* VFD | DOL inrush stresses pump and supply |
| ≥ 2 HP, or any 3φ | **VFD via RS485/Modbus** — no relay | Outside the relay path entirely |

### Pump branch sizing (single-phase, 220–240 VAC)

Cable size assumes ≤ 20 m run. For longer runs, step up one size, or compute voltage drop (> 3 % at FLA = upsize).

| Pump | Run FLA | LRA (DOL inrush) | Breaker | Cable (Cu) |
|---|---|---|---|---|
| 0.5 HP / 0.37 kW | ~2.5 A | ~12–15 A | 10 A C | 1.5 mm² |
| 0.75 HP / 0.55 kW | ~3.5 A | ~18–22 A | 16 A C | 2.5 mm² |
| 1 HP / 0.75 kW | ~4.8 A | ~25–30 A | 16 A C | 2.5 mm² |
| 1.5 HP / 1.1 kW | ~7 A | ~35–42 A | 20 A C/D | 4 mm² |

### Always include

- **Thermal overload** alongside the contactor — protects the pump motor.
- **Dry-run / no-load protection** on the pump itself — saves submersibles.
- **Earth bonding** of pump body, contactor enclosure, and controller DIN rail.

## Common mistakes

- **Sharing the pump's earth return through the DC rail.** Don't. Star-ground separately at a single bonding point.
- **Daisy-chaining valve power.** Each valve gets its own pair from the controller — daisy-chained valves brown each other out during inrush.
- **Skipping the contactor "because the relay is rated 10 A".** Inductive inrush is what kills relays; welded contacts mean the pump won't stop on command.
- **Running sensor cables alongside mains in the same conduit.** Induced noise wrecks pulse counts. Keep ≥ 10 cm separation, or use separate conduit.
- **Unregulated 12 V wall-warts.** They sag under solenoid inrush and brown-out the ESP32. Use a regulated SMPS.
