# MajiFlow Patent Research

**Date**: 2026-04-11
**Status**: Research complete, ready for provisional filing

---

## System Overview

MajiFlow is a desktop application that generates safety-critical embedded firmware for ESP32-based water distribution controllers from a visual graph topology. The system spans visual editor, graph algorithms, validation engine, code generation, and generated firmware executing on microcontrollers controlling physical pumps, valves, and sensors.

**No comparable prior art exists for the integrated system.**

---

## Recommended Filing: One Patent, Three Independent Claims

### Claim 1 — System Claim (Primary)

A water distribution automation system comprising:

- **(a)** Visual topology editor where self-describing entity descriptors (SVG, schema, constraints, codegen templates) define graph nodes
- **(b)** Route derivation engine enumerating all cycle-free paths; conflict classifier distinguishing sensor conflicts (blocking/queue) from actuator conflicts (non-blocking/refcount)
- **(c)** Validation engine evaluating entity-declared flow constraints (presence, ordering) with automation-driven severity escalation (warnings become errors for unattended routes)
- **(d)** Firmware generator producing:
  - Precomputed route table with valve bitmasks and conflict bitmasks (O(1) lookup)
  - Multi-slot concurrent state machine (IDLE/PREPARING/RUNNING/STOPPING/FAULT) with per-slot watchdogs
  - Pump reference counting across slots
  - Valve safe-close mask computation (exclude valves needed by other active slots)
  - Flow watchdog distinguishing no-flow fault from tank-full based on confirmation history
  - Tank level ADC suppression during active pump routes (prevents pressure artifacts)
- **(e)** Board abstraction resolving logical pins to native GPIO or I2C expander YAML from board definitions
- **(f)** Home automation integration mapping topology node IDs to platform entity IDs for dashboards and automations

### Claim 2 — Method Claim

Same pipeline as steps, covering the process regardless of implementation platform.

### Claim 3 — Apparatus Claim

The embedded microcontroller executing the generated firmware, covering the runtime behavior on the ESP32.

### Dependent Claims (15-20)

1. Consecutive-zero sensor fault detection (3 zeros after confirmed flow = sensor fault)
2. Pump-rated vs non-pump-rated tank sensor classification for runtime level checks
3. VFD/Modbus register map generation from visual node
4. Circular buffer route queue with conflict-based dequeue
5. Namespace-prefixed composite graph for multi-system sites
6. Seed change management with SHA-256 non-destructive default sync
7. OLED state machine display rendering (routes, faults, tank levels, battery, WiFi)
8. Hardware interlock generation for dual-relay motorized valves (100ms wait)
9. Generation history with reproducible topology+board snapshots
10. Priority-based boot sequence (close all valves on power-up)
11. API heartbeat watchdog (configurable timeout, FAULT_API_LOST)
12. Single-pass entity-driven codegen collection
13. HA-adjustable safety parameters (flow watchdog, confirm time, max runtime) without recompile
14. Combined tank level sensor with critical-low binary alert
15. Differential pressure filter blockage detection

---

## Prior Art Analysis

### No Prior Art Found

| Innovation | Key Files |
|---|---|
| Sensor vs actuator conflict dichotomy (queue vs refcount) | `src/lib/graph/conflicts.ts` |
| Tank level suppression during pump operation | `src/lib/entities/tank.ts` |
| Full topology-to-safety-firmware pipeline | `src/lib/codegen/generate.ts` → `generators/*` |
| Bitmask valve/conflict dispatch from graph | `src/lib/codegen/generators/routes.ts` |

### Limited Prior Art (MajiFlow is distinguishable)

| Innovation | Closest Prior Art | Gap |
|---|---|---|
| Multi-slot state machine + pump refcount | US 9,712,098 (pump safety) | Single-route, no concurrent slots, no codegen |
| Entity-declared constraints + escalation | US8823536 (IT alert escalation) | Physical safety routes, not IT recovery |
| Board-agnostic pin resolution | ESPHome native support | Automatic resolution from board YAML during codegen |
| VFD Modbus codegen from visual node | Manual PLC programming | Visual node to complete register map firmware |
| Flow sensor fault detection | PMC9860875 (ML-based) | Simple consecutive-zero on constrained MCU |

### Known Prior Art (Individual Elements)

| Element | Prior Art | Why System Claim Still Holds |
|---|---|---|
| IoT topology to code | US20210250244 | Generates communication glue, not safety firmware |
| Graphical firmware codegen | WO1999022295A2 | ACPI power management, not water distribution |
| State machine code generation | WO2018007822A1 | Generic modeling, not water-specific with pump refcount |
| Irrigation controller | US7123993 | Static zone scheduling, no graph-derived routing |
| No-code IoT codegen | DeviceTalk (MDPI) | Function chains, not topology-derived safety routes |
| Resource scheduling conflicts | US20020157043A1 | Logical resources, not physical sensor disambiguation |
| Cross-cloud namespace | US20160105393A1 | Cloud resources, not physical water networks |

---

## Non-Obviousness Argument

The system produces synergistic results unpredictable from individual components (KSR v. Teleflex test):

- Graph traversal alone doesn't know about water physics or sensor ambiguity
- Code generation alone doesn't produce safety state machines with pump refcounting
- Drawing a pipe between two nodes automatically derives safety constraints, validates pin conflicts, and generates deployable firmware
- Tank level suppression depends on state machine state, which depends on route derivation, which depends on the visual topology

The integration is the invention. No subset of components achieves what the whole system does.

---

## Alice Eligibility (Section 101)

| Factor | MajiFlow |
|---|---|
| Tied to specific machine | ESP32 MCU with GPIO/I2C peripherals |
| Physical transformation | Controls pumps, valves, reads ADC sensors |
| Technical improvement | Prevents unsafe concurrent water routing, sensor-ambiguous reads |
| Mental process | No — concurrent state machine + real-time watchdogs on MCU |
| Generic computer | No — specific embedded hardware with pin resolution |

Favorable under August 2025 USPTO memo (preponderance standard) and Ex parte Desjardins (Nov 2025, precedential — evaluate specification-described improvements, don't abstract to generic concepts).

---

## Jurisdictional Strategy

| Jurisdiction | Approach | Cost (self-filed) | Timeline |
|---|---|---|---|
| **US Provisional** | System + method + apparatus claims | ~$160 | File immediately |
| **Kenya (KIPI)** | Apparatus claim (HW controlled by SW) | ~KES 3,000 | File simultaneously |
| **PCT** | Preserve international rights | ~$3,000-5,000 | Within 12 months |
| **US Utility (full)** | Convert provisional with attorney | $8,000-15,000 | Within 12 months |

**Note**: Pure software is not patentable under Kenyan law. Frame Kenya filing around the apparatus: ESP32 + relays + sensors + valves controlled by generated firmware.

---

## Key Specification Files

| Layer | Files |
|---|---|
| Route derivation | `src/lib/graph/routes.ts` |
| Conflict detection | `src/lib/graph/conflicts.ts` |
| Constraint engine | `src/lib/graph/constraints.ts`, `evaluate-constraints.ts`, `evaluate-escalations.ts` |
| Entity registry | `src/lib/entity-registry.ts`, `src/lib/entities/*.ts` |
| Manifest conversion | `src/lib/topology-to-manifest.ts` |
| Codegen orchestrator | `src/lib/codegen/generate.ts` |
| Route table + dispatch | `src/lib/codegen/generators/routes.ts` |
| State machine + watchdogs | `src/lib/codegen/generators/control.ts` |
| Sensor codegen | `src/lib/codegen/generators/sensors.ts` |
| Hardware codegen | `src/lib/codegen/generators/hardware.ts` |
| Board package | `src/lib/codegen/generators/board-package.ts` |
| Device + OLED | `src/lib/codegen/generators/device-yaml.ts` |
| Pin resolution | `src/lib/codegen-ids.ts` |
| Board definitions | `defaults/boards/heltec-v3/board.yaml`, `defaults/boards/kc868-a16/board.yaml` |
| Validation rules | `src/lib/rules/manifest/*.ts` |
| Composite graph | `src/lib/graph/composite-graph.ts` |
| Dashboard generation | `src/lib/codegen/generators/dashboard.ts` |
| Automation generation | `src/lib/codegen/generators/automation-engine.ts` |

---

## CPC Classifications

- **G05D 7/00** — Control of flow
- **G06F 8/35** — Code generation
- **H04L 67/12** — IoT communication
- **G01F 23/00** — Level measurement
- **G05B 19/042** — PLC/embedded control

---

## Next Steps

1. File US provisional immediately ($160) — locks priority date
2. File KIPI provisional simultaneously (~KES 3,000)
3. Document invention date via dated git commits
4. Engage patent attorney within 6 months to refine claims
5. Convert to full utility application within 12 months
6. Evaluate PCT filing for international protection
