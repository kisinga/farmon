<!-- generated from packages/core/src/templates/pages/docs/installation/power-and-wiring.hbs — do not edit -->
# Power and Wiring Guide

MajiFlow installations use **a single 12 V DC rail for everything controller-side**: the KC868-A16 board, all solenoid valves, and all sensors share one supply. Mains (220–240 VAC, single-phase) is separate and only powers the pump, switched indirectly through a contactor.

One DC PSU. One mains feed. One contactor. That's the install.

---

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

---

## DC power supply (12 V rail)

The KC868-A16 board, every 12 V DC solenoid valve, and every sensor draw from one 12 V supply.

### Sizing

MajiFlow's default valve type is a **2-wire motorized valve**: the controller energizes an OPEN or CLOSE motor for ~15 s of travel, then the valve mechanically latches and draws zero current. Steady-state load is essentially just the board.

Concurrent valve activations are firmware-capped at 2 (briefly 3 during a route handoff). With motorized valves, worst-case demand is short and modest:

| Installation | Steady (no valves moving) | Peak (handoff: pump on + 2 motors traveling) |
|---|---|---|
| Any size, 1–8 valves | ~0.25 A | ~1.0 A for ~15 s |

**One-line rule:** *A 12 V / 2 A regulated supply (24 W) covers any single-controller install with motorized valves. **Direct-wired DC solenoid valves are different — each holds ~0.6 A continuously while open, so an install with those needs 12 V / 5 A (60 W) instead.***

#### Per-device current budget (for the curious)

| Load | Draw |
|---|---|
| KC868-A16 — board idle, Ethernet active, OLED on | ~0.20 A |
| KC868-A16 — same, plus all 16 relay coils energized (worst-case transient) | ~0.75 A |
| Motorized 2-wire valve — during ~15 s travel | ~0.4 A |
| Motorized 2-wire valve — at rest (open or closed, mechanically latched) | 0 A |
| Direct-wired DC solenoid valve — holding | ~0.6 A *(continuous while open — drives the 5 A spec)* |
| Hall-effect flow sensor | ~10 mA each |
| Tank level sensor (op-amp conditioned) | ~20 mA each |

Use a **regulated** supply (SMPS), not an unregulated wall-wart. Motor start and any solenoid inrush will sag an unregulated 12 V brick below the ESP32's brown-out threshold.

---

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

### PSU → controller

The PSU normally lives in the same enclosure as the controller (< 1 m). If remote-mounted, size for full peak draw (~4 A worst case):

| Cable size | Max one-way length |
|---|---|
| 1.5 mm² | **5 m** |
| 2.5 mm² | **8 m** |
| 4.0 mm² | **13 m** |

Beyond 5 m, **mount the PSU next to the controller** and run mains the long distance instead. Mains tolerates voltage drop better than 12 V DC.

### Sensor cables

Use **shielded twisted pair**. Ground the shield at the controller end only.

| Sensor | Signal | Cable | Max length |
|---|---|---|---|
| Flow sensor (Hall pulse) | digital pulse, 5–12 V | shielded 2-pair, 0.34 mm² | **30 m** |
| Tank level (0–5 V analog) | analog | shielded twisted pair, 0.34 mm² | **20 m** |
| DS18B20 temperature | 1-Wire | shielded, 0.34 mm² | **15 m** |

Beyond these distances pulse counts get noisy and ADC readings drift. Mount the controller closer, or deploy a second KC868-A16 as a remote node linked over Ethernet.

---

## Mains and the pump (separate from the DC rail)

The KC868-A16 relay does **not** carry pump current. It switches a **contactor coil**; the contactor switches the pump. This is true even for small pumps where the relay rating is technically sufficient — the contactor is the field-replaceable wear part.

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
| 0.25 HP / 0.18 kW | ~1.5 A | ~8 A | 6 A C | 1.5 mm² |
| 0.5 HP / 0.37 kW | ~2.5 A | ~12–15 A | 10 A C | 1.5 mm² |
| 0.75 HP / 0.55 kW | ~3.5 A | ~18–22 A | 16 A C | 2.5 mm² |
| 1 HP / 0.75 kW | ~4.8 A | ~25–30 A | 16 A C | 2.5 mm² |
| 1.5 HP / 1.1 kW | ~7 A | ~35–42 A | 20 A C/D | 4 mm² |

Notes:
- D-curve breakers tolerate motor inrush without nuisance-tripping; C-curve is fine up to ~1 HP.
- Submersible-pump nameplates often understate LRA — use the upper end of the inrush column for sizing.
- A VFD or soft-starter collapses inrush to ~1.2–1.5 × FLA, making the LRA column irrelevant.

### Always include

- **Thermal overload** alongside the contactor — protects the pump motor.
- **Dry-run / no-load protection** on the pump itself — saves submersibles.
- **Earth bonding** of pump body, contactor enclosure, and controller DIN rail.

---

## Bill of materials — typical compact installation (6 valves, 1 HP pump)

| Item | Spec | Qty |
|---|---|---|
| KC868-A16 controller | — | 1 |
| DC power supply | Mean Well RS-25-12 (12 V / 2 A, motorized valves) — *use LRS-50-12 (12 V / 4.2 A) if the install has direct DC solenoid valves* | 1 |
| Solenoid valves | 12 V DC, NC, 3/4" | 6 |
| Pump contactor | 9 A AC-3, 230 V coil | 1 |
| Thermal overload | 4–6 A range | 1 |
| MCB — pump branch | 16 A C-curve | 1 |
| MCB — DC supply primary | 6 A C-curve | 1 |
| DIN rail enclosure | IP54, ≥ 10 modules | 1 |
| Valve cable | 1.0 mm² 2-core, length per run | per run |
| Sensor cable | 0.34 mm² shielded twisted pair | per run |

---

## Common mistakes

- **Sharing the pump's earth return through the DC rail.** Don't. Star-ground separately at a single bonding point.
- **Daisy-chaining valve power.** Each valve gets its own pair from the controller — daisy-chained valves brown each other out during inrush.
- **Skipping the contactor "because the relay is rated 10 A".** Inductive inrush is what kills relays; welded contacts mean the pump won't stop on command.
- **Running sensor cables alongside mains in the same conduit.** Induced noise wrecks pulse counts. Keep ≥ 10 cm separation, or use separate conduit.
- **Unregulated 12 V wall-warts.** They sag under solenoid inrush and brown-out the ESP32. Use a regulated SMPS.

---

## See also

- [KC868-A16 Board Guide](kc868-a16.md) — capacity, calibration, RS485 usage
- [Glossary](../glossary.md) — site / system / topology / route / manifest
