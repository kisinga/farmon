# MajiFlow Easy Mode: Onboarding Composition Spec

Status: draft for review. Decisions resolved 2026-06-21. This is the contract a
build follows. Implementation derives node facts from the entity registry and the
board file, not from this document (section 13).

## 1. Purpose and scope

Easy Mode turns a few plain questions into a complete, valid
[`SiteTopology`](../../src/lib/topology.types.ts) and opens it in the existing
[X6 canvas](../../src/app/pages/editor/topology-x6-tab/) (Expert Mode) for
fine-tuning. It replaces the blank canvas for simple sites.

One-way lowering: Easy Mode generates, Expert Mode is the full superset. You go
easy to expert, never back.

**In scope:** one supply or a few merging at one tank, zero or one tank, fan-out
to several demand zones. A tree.

**Out of scope (hand to Expert Mode):** two or more tanks, branching tank
networks, merges and loops, cross-system links, manual pins.

**Augment, do not replace.** Most sites here are mechanical (a float valve fills
the tank, gravity or a switched pump moves water). Easy Mode adds control and
monitoring on top of that. It does not assume a fully sensed system.

**Correct by construction, validated as backstop.** The generated graph is built
from the same entity definitions Expert Mode validates against, then run through
that validator before it is shown. Two rules bite in particular:
- valve before flow on a pump outlet
  ([pump-outlet-ordering](../../src/lib/entities/pump.ts), error),
- a pressurized source in a controlled route needs a downstream valve
  ([source-downstream-valve](../../src/lib/entities/water-source.ts), error).

## 2. Design principles

1. **Stations are asked, transfers are inferred.** The customer says what they
   have; the engine derives the plumbing between them.
2. **Flat questions.** Five flat questions, one conditional (conveyance). No
   decision tree.
3. **Capability gating is one flag.** Unsupported nodes (filter, dosing, vfd) are
   disabled: they never synthesize, and any option that only feeds them hides.
4. **Data-driven and external.** Customer-facing copy, station groupings, and
   capability toggles live in one editable file outside source. Node semantics do
   not (section 13).
5. **One board is the sandbox.** Always one [KC868-A16](../../defaults/boards/kc868-a16/),
   never named to the customer: 16 relays, 4 analog, 3 pulse. When a design runs
   out of any pool, Easy Mode steps aside to Expert Mode or paid setup.

## 3. The site profile

Questions fill a flat profile. Stations and rules read it.

| Key | Type | Source | Notes |
|---|---|---|---|
| `vertical` | residential, small_business, farm, hotel, greenhouse, commercial, water_business | asked | seeds defaults |
| `source` | set of: mains, borehole, river, trucked, rainwater | asked (multi-select) | one supply each; two or more merge at the tank |
| `pressurized` | bool | derived | true for mains only |
| `surface` | bool | derived | true for river, rainwater |
| `tanks` | 0 or 1 | asked | several hands to Expert Mode |
| `zones` | int (1..7) | asked | capped by relays |
| `conveyance` | gravity, pump | asked (conditional) | observed water force, see 4.2 |
| `metering` | bool | derived | on per-connection for water_business |
| `priority` | dry_run, continuity, waste, quality, labor | asked | tunes automations and dashboard only, never safety |

Tank level monitoring is not a profile value. It is inferred per tank from how
the tank is filled (section 6).

## 4. Questions

### 4.1 Flat set (everyone, fixed order)

1. **What kind of site is this?** sets `vertical`. Options with one-line examples:
   Home or residential; Small business or shop; Irrigation farm (drip blocks,
   sprinkler lines); Hotel or hospitality (lodge, guesthouse, restaurant);
   Greenhouse or nursery; Commercial or industrial; Water supply business (kiosk,
   community scheme, reselling).
2. **Where does your water come from?** (select all that apply) sets `source`,
   `pressurized`, `surface`. Mains, Borehole or well, River or dam, Water trucking
   or bowser, Rainwater harvesting. Helper: "If you pick more than one, we assume
   they fill one shared tank."
3. **Do you store water on site?** sets `tanks`. No; One tank; Several (needs the
   editor, routes to Expert Mode).
4. **How many areas need to be turned on or off separately?** sets `zones`. "Each
   gets its own automatic valve. Areas always watered together count as one."
   Per-vertical example. One; Two or three; Four to seven; More than seven (needs
   a bigger setup, routes to setup service before the rest of the form). Show live
   budget during number entry ("11 of 16 relays used, room for N more areas").
5. **What worries you most?** sets `priority`. Running dry, Losing supply, Waste
   or cost, Water quality, Manual labor. Tunes automations and dashboard order,
   never safety.

There is no treatment question. For surface water, show a non-blocking note:
"Surface water needs a filter before drip or sprinklers, add one in the editor."

### 4.2 Conditional follow-up (the one exception)

- **Does the water need a pump to reach where it's used?** sets `conveyance`.
  Shown when `tanks == 1`. Help: it travels far, runs uphill, or needs more
  pressure than the tank gives on its own. Options: No, it gets there on its own
  (gravity); Yes, a pump pushes it (pump).

  Deliberately generic: no assumption of sprinklers or any vertical, it asks only
  whether the draw needs a boost. We trust the answer; the vertical never forces
  a pump. (A fully context-aware, per-industry question set is a larger change,
  see section 15.)

### 4.3 Inferred, never asked

`metering`, `pressurized`, `surface`, tank level monitoring, all transfer
contents, pins, polarity, safety timings, calibration, automations, dashboard.

## 5. Station catalog

| Station id | When | Intrinsic nodes | Ports | Flags |
|---|---|---|---|---|
| `supply.mains` | `mains in source` | water_source (pressurized) | out | pressurized |
| `supply.borehole` | `borehole in source` | water_source + submersible pump | out | not pressurized; check valve assumed |
| `supply.river` | `river in source` | water_source + surface pump | out | not pressurized; foot valve + strainer assumed; surface |
| `supply.trucked` | `trucked in source` | water_source | out | manual, availability unknown |
| `supply.rainwater` | `rainwater in source` | water_source | out | surface |
| `storage.tank` | `tanks == 1` | tank | in, out | the hub; level inferred (section 6) |
| `demand.zone` | `zones>=1` | endpoint | in | repeat `zones` |

Notes:
- The tank is the hub, so the topology is a tree.
- Borehole and river are not pressurized: a stopped pump holds back-pressure only
  through a check valve. That makes a no-valve fill legal, and the pump relay is
  the control. Mains is pressurized, so its fill always gets an isolation valve
  (required downstream of a pressurized source, and a remote shut-off on top of
  the mechanical float valve).
- Trucked is manual: no auto-refill (you cannot automate a truck), only a low
  alert; downstream logic must not assume it is always available.
- Two or more sources make one supply each, all feeding the one tank. Multi-source
  therefore needs a tank; the fill prefers mains, with the others as backup.

## 6. Transfer synthesis rules

A transfer connects a parent outlet to a child inlet, synthesized from the two
ends plus the profile. Fan-out at a parent adds one valve per branch.

Predicates for transfer `T`, parent `P`, child `C`:
- `pressuredUpstream(T)` = `P` has a pressurized outlet (mains only).
- `needsPressure(T)` = the customer answered `conveyance == pump`, or it is a
  tank fill that must be lifted. The vertical never forces it.
- `gravityFed(T)` = `conveyance == gravity`. No booster.
- `hasUpstreamPump(T)` = `P` has an intrinsic pump (borehole, river).

Rules:

| Element | Add when | Capability |
|---|---|---|
| filter | surface, or treatment requested | off (v1) |
| dosing | full treatment | off (v1) |
| pump | `needsPressure(T)` and not `pressuredUpstream(T)` and not `gravityFed(T)` | on |
| flow | a pump needs dry-run protection and its source has no level, or `hasUpstreamPump(T)`, or metering | on |
| valve | `P` fans out (one per branch), or a controlled transfer with no controllable pump, or the source is pressurized (a valve is required downstream) | on |

Physical order on a pump outlet: `pump -> valve -> flow`. A flow sensor never
sits on a pump outlet ahead of a valve. On a fan-out, the dry-run flow sensor
sits behind a valve, before the branch split.

**Tank level is inferred from the fill, not asked.** A pump-filled tank
(borehole, river, trucked-then-pumped) gets continuous ADC level: the firmware
needs it to stop the fill at full and to dry-run-protect the draw pump by low
level. A mechanically filled tank (a mains float valve) stays passive (no ADC):
the float valve stops the fill, and the draw pump is dry-run-protected by a flow
sensor instead. Level thresholds are coarse (full ~90%, low ~20%) so default
calibration is good enough, with a "calibrate later" nudge; precise percentage is
not promised out of the box.

Booster is never forced. If the demand is drip or sprinkler (farm, greenhouse)
and the customer answered gravity, show a non-blocking suggestion ("Drip and
sprinklers usually need more pressure than a gravity tank gives. Add a booster
pump?"). Nothing is added unless they accept.

Dry-run protection is on wherever a pump exists, derived from pump presence,
never from `priority`, with a restart lockout after a fault. Dead-head guard: a
pump may not run unless at least one downstream valve is open.

Metering: per-connection for water_business (one flow sensor per demand branch,
capped at the 3 pulse pins, beyond which hand off). Bulk or none otherwise. A
safety dry-run flow sensor always wins a pulse pin over a pure meter.

Fan-out is a sequential manifold: at most two routes run at once, one booster
serializes its zones.

In v1 filter and dosing are off, so nothing is filtered; the surface-water note
covers it. A coarse intake strainer and foot valve are assumed on a surface
suction (a hydraulic given, not a node).

## 7. Assembly algorithm

1. **Fill the profile.** Vertical priors, then answers, then derive the rest.
2. **Instantiate stations.** One supply per source, one tank if `tanks == 1`,
   `zones` zones.
3. **Build the tree.** Supply(s) feed the tank; tank feeds the zones. No tank:
   the single supply feeds the zones directly. Several sources merge at the tank,
   fill preferring mains.
4. **Synthesize transfers** with section 6, in valid physical order.
5. **Fit the board.** Tally against the KC868-A16 pools as the form is answered:
   `relays = pumps (incl. submersible) + 2 x valves <= 16`,
   `analog = pump-filled tanks <= 4`, `pulse = flow sensors <= 3`. Gate on the
   pool that fills first and name it.
6. **Apply safe defaults** (below). Priority only tightens these or reorders the
   dashboard; it never relaxes a pump-protection value.
7. **Validate** against the entity rules. On any error, fix or hand to Expert
   Mode rather than emit.
8. **Emit** the `SiteTopology` and open Expert Mode.

Safe defaults, every route, regardless of priority:

| Field | Default |
|---|---|
| dest_max_level | 90 to 95% (where the tank has level) |
| source_min_level | 15 to 20% (where the source has level) |
| valve_travel | 15 s |
| flow_confirm | 10 to 15 s (shorter for a submersible) |
| flow_watchdog | 30 s general, shorter for a submersible |
| max_runtime | conservative per route, a backstop not the main stop |
| dry-run | on wherever a pump exists, plus a restart lockout |

Per-zone watering automations get staggered, non-overlapping windows with a
conservative run duration, since the manifold is sequential.

## 8. The data document

One editable file outside source: capability flags, questions, stations, transfer
rules, assembly. References entity kinds and the board by stable id only; carries
no node semantics (section 13).

```json
{
  "capabilities": { "filter": false, "dosing": false, "vfd": false },

  "questions": [
    { "id": "vertical", "fills": "vertical", "flat": true,
      "prompt": "What kind of site is this?",
      "options": [
        { "label": "Home or residential",   "sets": { "vertical": "residential" } },
        { "label": "Irrigation farm",        "sets": { "vertical": "farm" } },
        { "label": "Water supply business",  "sets": { "vertical": "water_business" } }
      ] },

    { "id": "source", "fills": "source", "flat": true, "multi": true,
      "prompt": "Where does your water come from? (select all that apply)",
      "help": "If you pick more than one, we assume they fill one shared tank.",
      "options": [
        { "label": "Borehole or well", "adds": { "source": "borehole", "pressurized": false } },
        { "label": "Mains",            "adds": { "source": "mains",    "pressurized": true  } },
        { "label": "River or dam",     "adds": { "source": "river",    "surface": true     } }
      ] },

    { "id": "tanks", "fills": "tanks", "flat": true,
      "prompt": "Do you store water on site?",
      "options": [
        { "label": "No",       "sets": { "tanks": 0 } },
        { "label": "One tank", "sets": { "tanks": 1 } },
        { "label": "Several",  "handoff": "expert" }
      ] },

    { "id": "zones", "fills": "zones", "flat": true,
      "prompt": "How many areas need to be turned on or off separately?",
      "help": "Each gets its own automatic valve. Areas always watered together count as one.",
      "options": [
        { "label": "One",           "sets": { "zones": 1 } },
        { "label": "Two or three",  "sets": { "zones": "ask_number" } },
        { "label": "Four to seven", "sets": { "zones": "ask_number" } },
        { "label": "More than seven", "handoff": "setup_service" }
      ] },

    { "id": "priority", "fills": "priority", "flat": true,
      "prompt": "What worries you most?",
      "options": [
        { "label": "Running dry",  "sets": { "priority": "dry_run" } },
        { "label": "Waste or cost","sets": { "priority": "waste" } }
      ] },

    { "id": "conveyance", "fills": "conveyance", "flat": false, "showWhen": "tanks==1",
      "prompt": "Does the water need a pump to reach where it's used?",
      "help": "It travels far, runs uphill, or needs more pressure than the tank gives on its own.",
      "options": [
        { "label": "No, it gets there on its own", "sets": { "conveyance": "gravity" } },
        { "label": "Yes, a pump pushes it",         "sets": { "conveyance": "pump" } }
      ] }
  ],

  "stations": [
    { "id": "supply.borehole", "when": "borehole in source",
      "intrinsic": ["water_source(pressurized=false)", "pump(role=submersible)"],
      "ports": { "out": 1 } },
    { "id": "supply.mains", "when": "mains in source",
      "intrinsic": ["water_source(pressurized=true)"], "ports": { "out": 1 } },
    { "id": "supply.river", "when": "river in source",
      "intrinsic": ["water_source(pressurized=false)", "pump(role=surface)"],
      "ports": { "out": 1 } },
    { "id": "supply.trucked", "when": "trucked in source",
      "intrinsic": ["water_source(pressurized=false)"], "ports": { "out": 1 } },
    { "id": "storage.tank", "when": "tanks==1",
      "intrinsic": ["tank"], "ports": { "in": 1, "out": 1 } },
    { "id": "demand.zone", "when": "zones>=1", "repeat": "zones",
      "intrinsic": ["endpoint"], "ports": { "in": 1 } }
  ],

  "transferRules": [
    { "element": "filter", "enabled": false, "addWhen": "surface || treatment!='none'" },
    { "element": "dosing", "enabled": false, "addWhen": "treatment=='full'" },
    { "element": "pump",   "enabled": true,  "addWhen": "needsPressure && !pressuredUpstream && !gravityFed" },
    { "element": "flow",   "enabled": true,  "addWhen": "(hasPump && !sourceHasLevel) || hasUpstreamPump || metering" },
    { "element": "valve",  "enabled": true,  "perBranch": true,
      "addWhen": "branches || (controlled && !hasControllablePump) || (pressuredUpstream && controlledFill)" }
  ],

  "assembly": {
    "shape": "tree", "multiSupplyTanks": true, "fanOut": "demand",
    "board": "kc868_a16",
    "budget": { "relays": 16, "analog": 4, "pulse": 3 }
  }
}
```

## 9. Worked examples

Generated by the composer and checked by
[test/compose.test.ts](../../test/compose.test.ts); tallies use the board pools
(16 relays, 4 analog, 3 pulse).

### 9.1 Farm, borehole, one tank, three fields, pump
`borehole -> tank -> {field1, field2, field3}`. Pump-filled tank, so ADC level.
- Fill: submersible runs to full (stop on tank level), flow sensor for borehole
  dry-run.
- Draw: booster, one valve per field, dry-run by tank low level.
Tally: 8/16 relays (submersible + booster + 3 valves), 1/3 pulse, 1/4 analog.

### 9.2 Home, mains, one tank, one house, pump
`mains -> tank -> house`. Mains-filled, so the tank stays passive (no ADC); a
mechanical float valve does the level cut-off.
- Fill: an isolation valve (required downstream of pressurized mains, also a
  remote shut-off).
- Draw: booster, dry-run by a flow sensor (no tank level to lean on).
Tally: 3/16 relays (fill valve + booster), 1/3 pulse, 0/4 analog.

### 9.3 Water business, mains, no tank, three kiosks
`mains -> {kiosk1, kiosk2, kiosk3}`. Per-connection metering: a valve and a flow
sensor on each branch (valve before flow, valve downstream of pressurized mains).
Tally: 6/16 relays, 3/3 pulse, 0/4 analog. A fourth kiosk needs a fourth pulse
pin, so it hands off.

### 9.4 Home, mains and borehole, one tank, one house, pump
`{mains, borehole} -> tank -> house`. Pump-filled (borehole), so ADC level.
- Mains fill: an isolation valve. Borehole fill: a flow sensor for the
  submersible. The fill prefers mains, borehole as backup.
- Draw: booster, dry-run by tank low level.
Tally: 4/16 relays (fill valve + submersible + booster), 1/3 pulse, 1/4 analog.

## 10. Decisions (resolved)

1. **Capacity gate** on the relay/analog/pulse pools of one KC868-A16, naming the
   pool that fills first.
2. **Priority shipped**, tuning automations and dashboard only.
3. **Multi-source supported** via multi-select; sources merge at the one tank,
   fill preferring mains.
4. **Board auto and fixed** to the KC868-A16, never asked.
5. **One tank in v1.** No tank or one tank; several hands to Expert Mode. This
   removes the unguessable series-vs-parallel multi-tank case.
6. **Metering inferred**, not asked: per-connection for water_business, else bulk
   or none.
7. **No treatment question**; a surface-water advisory replaces it.
8. **Tank level inferred from the fill**: ADC level for a pump-filled tank, passive
   for a mechanically filled one. No new sensor invented, no question.

## 11. Out of scope (Expert Mode only)

Two or more tanks, transfer authoring, round-tripping expert graphs back to
stations, arbitrary graphs, multi-system splitting, manual pins.

## 12. Notes from the expert review

The review (7 field experts plus synthesis) drove sections 5 to 9: the valve/flow
ordering, unpressurized borehole, the pin-budget gate, the observed-force
conveyance question, concrete safety defaults decoupled from priority, sequential
fan-out, and the mechanical-first stance. The five open items it raised are now
resolved in section 10 (items 5 to 8 plus multi-source).

## 13. Binding to the entity registry

The composer does not restate node facts. It depends on
[`NODE_REGISTRY`](../../src/lib/entity-registry.ts) and a board profile, and
derives:

| Need | From |
|---|---|
| ports (inlet/outlet) | `NodeDescriptor.defaultPorts` |
| default params | `NodeDescriptor.defaultData` |
| element order on a pump outlet | `NodeDescriptor.constraints` (pump-outlet-ordering) |
| "pressurized source needs a valve" | `NodeDescriptor.routeRules` (source-downstream-valve) |
| required dry-run sensor | `NodeDescriptor.safetyProfile.requiredSensors` |
| pin cost per node | `NodeDescriptor.sidebarFields[].pinCap` summed vs board pin caps |
| capability on/off | the recipe's `capabilities`, cross-checked against `experimental` |

Two small derived helpers, pure functions over existing descriptor fields, not
new stored data:
- `providesPressure(node)` = `isPump || (kind === 'water_source' && data.pressurized)`
- `pinCost(node)` = count of its `pin` fields grouped by `pinCap`

The recipe (section 8) holds only customer-facing copy, station groupings, and
capability toggles, all referencing kinds by stable id. The validator is the
backstop, not the primary safety net, because the graph is built from the same
definitions it checks.

## 14. Implementation status

Built:
- Composer: [src/lib/compose/easy-mode.ts](../../src/lib/compose/easy-mode.ts)
  (`composeEasyMode`, plus `providesPressure` and `pinCost`), exported from
  `@core`. Derives ports, defaults, and pins from the registry and board; runs
  the entity validator as a backstop; gates on the board pin budget.
- Recipe: [defaults/onboarding/recipe.json](../../defaults/onboarding/recipe.json)
  (questions, capability flags, station groupings).
- Tests: [test/compose.test.ts](../../test/compose.test.ts) covers the worked
  examples, the scope gates, and clean validation.

Pending:
- Onboarding UI: a stepper that fills the profile and calls the composer, mounted
  off the site-create flow.
- Safety defaults on the emitted topology: per-route `route_overrides`
  (dest_max_level, source_min_level, max_runtime) and staggered watering
  automations. The composer sets `timing` today; route overrides are a follow-up.
- Wiring the `expert` and `setup_service` handoffs to real destinations.

## 15. Context-aware questions (future architectural option)

Today the question set is flat with one conditional (`showWhen`). Questions use
generic, industry-neutral wording so one phrasing fits every vertical: the
conveyance question asks only whether the water needs a boost, with no assumption
of sprinklers, taps, or any trade. Preferring a vertical-neutral rewording over a
branch keeps v1 simple.

A fuller step is an adaptive question graph: question wording, options, and
visibility conditioned on prior answers and the vertical, driven by the recipe
data rather than baked in code. That is a real architectural change (a question
engine, and the recipe becoming the runtime source for copy) and should be taken
on only when generic phrasing stops being enough.
