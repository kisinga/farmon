# Route capability contract

Reference for the route/endpoint domain model and the rules that decide what a
route can do. Single owner: `routeCapabilities(route, nodeLookup)` (graph) and
`manifestRouteCapabilities(route)` (firmware route) in
[src/lib/route-capabilities.ts](../src/lib/route-capabilities.ts). Consumers read
it; they never re-derive these decisions.

## Layers

| Layer | Role | Shape | Derived from |
|---|---|---|---|
| Topology graph | Source of truth | nodes + pipes | authored |
| Firmware manifest | Device contract | flat, integer-indexed | topology |
| Domain read-model | App / UI / billing | typed classes (`Endpoint`, `RouteModel`, `SiteModel`) | topology |

The manifest and the domain model are independent projections of the same topology.
The app reads the domain read-model, not the manifest.

## Definitions

| Term | Meaning |
|---|---|
| Node | Typed topology entity (`tank`, `valve`, `pump`, `flow_sensor`, `endpoint` (open sink), `water_source`, ...). Traits live on `NODE_REGISTRY` (`isPump`/`isValve`/`isFlowSensor`/`conflictClass`) and per-entity Zod fields (`tank.level_monitored`, `tank.float_valve`, `tank.pressure_pump_rated`, `tank.capacity_l`). No parallel node class hierarchy. |
| Route | Ordered path from a source to an endpoint, plus the actuators and sensors it crosses. |
| Source | First node of the path (tank or water source). |
| Endpoint | Last node of the path (`nodeSequence[last]`); a tank or an open sink. The recipient, and the anchor for usage and labels. |
| Destination tank | The endpoint when it is a tank. Drives level / float / full. Equals the manifest `destination` field, which is `undefined` for open endpoints, so it is not the endpoint. |

## Identity

| Concern | Key |
|---|---|
| Durable records (runs, events, automations) | stable route `key` (`source>dest#valves`) + endpoint node id |
| Device wire | integer index (firmware slot id; meaning is version-dependent) |

- Resolve index to key at ingest, key to index at dispatch; persist the key.
- The durable layer is key-based (no backward compatibility, no migration, no backfill).
- `routeSetVersion` is a live staleness guard only (reject an automation set authored against a different route table), not a historical key.

## Capabilities

Primitives: `metered` = has a flow sensor; `level` = `destHasLevel && runtimeLevelOk`;
`float` = `destHasFloatValve`.

| Capability | Value |
|---|---|
| `runnable` | has a valve or a pump. Only runnable routes show a Start control. |
| `runKind` | `pump` / `valve` / `none` |
| `trackable` | `metered \|\| destHasLevel`. A bare tank-to-sink is neither. |
| `canStopOnFull` | `level \|\| (metered && float)` |

### Run targets (offered only on runnable routes)

| Target | Offered when | Reason shown when not |
|---|---|---|
| duration | always | "route has no actuator to run" |
| volume | `metered` | "needs a flow meter" |
| level | destination is a level-monitored tank | "destination has no level sensor" |

Volume has no "shared meter" exclusion: meter-sharing routes are mutually exclusive
(see Conflict), so one meter only ever measures one route at a time.

### Stall disposition

Meaning of a confirmed-then-ceased flow. Requires a meter (`n/a` otherwise).
Precedence: measurement beats inference.

| Condition | Disposition | Tier |
|---|---|---|
| no meter | `n/a` | no detection |
| `level` trusted | `levelAuthoritative` | level decides; an early stall is anomalous |
| else `float` | `full` | clean "tank full" stop |
| else (open endpoint, or tank with neither) | `flowLost` | warning, clean stop |

Firmware emits the matching stop reason: `dest_tank == 0xFF` (open endpoint) yields
`STOP_FLOW_STALLED` (warn tier); a tank destination yields `STOP_TANK_FULL`. Stop
tokens are append-only and index-bound (`STOP_REASON_TOKENS` paired with
`enum StopReason`).

## Conflict (mutual exclusion)

Routes that share a flow meter conflict, regardless of destination: one meter
measures one pipe, so two routes can never push metered flow through it at once.
Rule: [codegen/generators/routes.ts](../src/lib/codegen/generators/routes.ts)
`conflict_mask`.

- Consequence: every metered route's per-run volume is unambiguous, so volume is always offered when metered.
- Trade-off: no concurrent multi-feed through one meter (use separate meters for parallel-bank fast-fill).
- `conflict_mask` is generated; devices need a redeploy to apply a change.

## Runnable enforcement

A non-runnable route (no valve, no pump) is refused on both sides:

- App: Start suppressed on the card, the run picker, and automations; `routeCmd`/`routeRun` refuse it.
- Firmware: `try_route_start` returns REJECTED (code 2) for a route with no `valve_mask` and `pump_idx == 0xFF`.

## State

Domain classes are immutable structure (a pure projection of topology). Live
telemetry (running token, level %, flow, delivered litres) stays in the signal store
and is composed at the view (`RouteView = route + live`).

## Order invariance

`SiteModel` preserves `deriveRoutes` order and membership; `runnable`/`trackable`
are presentation tags, never derivation filters. The firmware route id is the
positional index, so reordering or dropping would repoint the runs ledger,
automations, and conflict masks. Guarded by
[test/route-capabilities.test.ts](../test/route-capabilities.test.ts).

## Usage

| Aspect | Rule |
|---|---|
| Ledger | route-keyed (`delivered_l` and counter continuity are per-meter-per-route) |
| Dashboard "Water usage" | per-route totals over a selected duration (volume if metered, else time, + run count); two routes to one endpoint read separately; placed beside the Activity feed |
| Endpoint roll-up | billing-attribution principle for a future customer view, not the dashboard |
| Buffer tank (multi-hop) | derivation splits it into segments; usage attributes to the immediate recipient; end-to-end is an app-side sum |
| Monitored customer tank | meter = billing authority, level % = operational; never mix in one alert/automation |

## Activity feed: runs

Completed runs are a feed source read directly from the durable `runs` collection:
`recentRuns` (newest-N) + `subscribeRuns` (live insert) + `toRun`. Each run row
carries its own duration + volume (no event-to-run join). The actor resolves
viewer-relatively (you / co-owner / Support) from `UsageRun.actor_id` via
`resolveInitiator`. Route-level state-transitions (`route >= 0`) are dropped from the
feed; controller events, failed/in-flight commands, and config changes stay.

## Files

| Concern | File |
|---|---|
| Capability owner | `src/lib/route-capabilities.ts` |
| Read-model | `src/lib/route-model.ts` |
| Conflict mask + route table codegen | `src/lib/codegen/generators/routes.ts` |
| Volume / tunable gate | `src/lib/tunable-numbers.ts` |
| Usage format + per-route roll-up | `src/lib/usage-format.ts`, `src/lib/usage-rollup.ts` |
| Totals widget | `src/app/pages/dashboard/widgets/usage-totals.component.ts` |
| Feed source wiring | `src/app/pages/dashboard/dashboard.store.ts`, `src/app/core/services/realtime.service.ts` |
| Stop reasons | `src/lib/codegen-ids.ts`, `firmware/components/maji_control/core.{h,cpp}` |
| Tests | `test/route-capabilities.test.ts`, `test/usage.test.ts` |

## Accepted trade-offs

| Trade-off | Reason |
|---|---|
| No concurrent multi-feed through one meter | a meter measures one pipe; mutual exclusion keeps volume attributable |
| Cross-clock feed ordering can wobble a few seconds | run rows are device-time, transitions/commands server-time; avoids fragile cross-clock matching |
| Greyed (not hidden) Start on non-runnable routes | "exists but can't run" reads clearer than a missing control |
| `actor` truncated to 15 chars in firmware | PocketBase ids are 15 chars; a longer id would fall back to "Support" (full id on `commands.issued_by`) |
