# MajiFlow — Architecture

## Overview

MajiFlow is a water network design tool. Users create **sites** (a physical location), add **systems** (individual ESP32 controllers), design each system's **topology** (tanks, pumps, valves, sensors connected by pipes), then generate and deploy ESPHome firmware. The running fleet reports over MQTT to the server, and operators watch and control it from the web dashboard.

```
Site (workspace)
  └── System A (topology + board)
  └── System B (topology + board)
  └── Inter-system links
```

## Tech Stack

- **Angular 21** — standalone components, signals, computed, effects
- **Tailwind CSS 4 + DaisyUI 5** — styling and component library
- **AntV X6** — topology canvas (node/edge graph visualization)
- **PocketBase + Go** — backend: auth, database, REST (`/api/farmon`), and the embedded MQTT broker
- **Firmware delivery** — the generated ESPHome project is downloaded as a zip and built locally via the bundled `compile.sh` (no desktop app)
- **@core** — shared TypeScript library inlined at `src/lib` (types, graph algorithms, codegen)

---

## State Management

### WorkspaceService — single source of truth

All site data lives in `WorkspaceService` (`src/app/core/services/workspace.service.ts`). It owns:

- **Site metadata** — name, friendly name, system placements, inter-system links
- **All system topologies** — every system's nodes, pipes, automations, timing, route overrides
- **All board definitions** — hardware specs for each system's target board
- **Active system focus** — which system is currently being edited
- **Dirty tracking** — per-system and site-level, tracks unsaved changes

The workspace is loaded when the user navigates to a site. It persists across navigation between site view and system editor.

### SystemEditorService — editing session facade

`SystemEditorService` (`src/app/core/services/system-editor.service.ts`) is a thin facade over `WorkspaceService`. It exposes the active system's topology/board via computed signals and adds session-specific state:

- **Validation results** — from ESPHome codegen validation
- **Generated files** — firmware output from deploy
- **Canvas SVG** — snapshot for documentation
- **Readonly flag** — template preview mode

Tab components (`DeviceTab`, `AutomationsTab`, etc.) inject `SystemEditorService`. They read topology/board and call `updateTopology(updater)`, which delegates to the workspace. This keeps tab components simple — they don't know about the workspace or site context.

### Other Services

- **LibraryService** — CRUD for system config files (templates + user configs)
- **SiteLibraryService** — CRUD for site files
- **BoardService** — board list + active board SVG for the pinout diagram
- **BackendService** — PocketBase client + `/api/farmon` calls (the single network seam)

---

## Node ID Uniqueness

Node IDs (`tank1`, `valve2`, `pump1`) are **globally unique across the entire site**, not just within a system. This eliminates the need for ID namespacing when merging systems for the composite site view.

**Generation:** `WorkspaceService.nextNodeId(kind)` scans all nodes across all systems to find the next available `${kind}N` number. Pipe IDs use the same pattern via `nextPipeId()`.

**Migration:** When loading a site, `WorkspaceService.migrateIds()` detects ID collisions across systems and renumbers them transparently. All references (pipes, route overrides, automations, site links) are updated. Migrated systems are marked dirty for auto-save.

---

## X6 Canvas

### X6Canvas class

`X6Canvas` (`src/app/pages/editor/topology-x6-tab/x6-canvas.ts`) is a framework-agnostic wrapper around AntV X6. It owns the `Graph` instance and provides:

- `reset(topology)` — clear + render + fit
- `render(topology)` — incremental reconciliation (add/update/remove nodes and edges)
- `highlight(selection, graph)` — visual highlighting for selected routes/nodes/pipes
- `setReadonly(boolean)` — toggle interaction mode
- Zoom, pan, undo/redo, SVG export

### Shape and Routing Configuration

Defined in `x6-shapes.ts`:

- **Node shape:** `image` — SVG data URIs from `NodeDescriptor.renderSvg()`
- **Port groups:** `inlet` (left), `outlet` (right), plus `-abs` variants for absolute positioning
- **Edge routing:** Manhattan router with `startDirections: ['right']`, `endDirections: ['left']`
- **Connector:** Rounded (smooths right-angle turns)

### Port Layout

Some entities (tanks, handoffs) define `portLayout` — fixed y-positions for ports. Without this, ports auto-space evenly on the node's edge. The `portLayout` keys must match port IDs exactly.

```typescript
// Tank descriptor
portLayout: { inlet: { y: 15 }, outlet: { y: 55 } }
```

### Boundary Nodes and excludeShapes

**Pattern:** Any decorative graph node (system boundary rectangles, labels, overlays) must use a registered custom shape that is excluded from the manhattan router's obstacle map.

**Why:** X6's manhattan router builds its obstacle map from `model.getNodes()`. A large boundary rectangle encompassing all real nodes corrupts pipe routing — the router either routes around it (producing different paths) or falls back to the simpler `orth` router. This is triggered when `ResizeObserver` fires after boundaries are added, causing X6 to re-route edges with the boundary in the obstacle map.

**How:**

```typescript
// x6-shapes.ts — register shape + exclude from router
export const BOUNDARY_SHAPE = 'boundary';
Shape.Rect.define({ shape: BOUNDARY_SHAPE });

export const MANHATTAN_ROUTER = {
  name: 'manhattan',
  args: {
    // ...
    excludeShapes: [BOUNDARY_SHAPE],
  },
};

// boundary-renderer.ts — use the excluded shape
graph.addNode({ shape: BOUNDARY_SHAPE, id: `boundary-${config}`, ... });
```

This pattern applies to any future decorative node added to the X6 graph.

### Composite Site View

The site view renders all systems on one canvas. It uses `WorkspaceService.compositeTopology()` which flat-merges all systems' nodes (with position offsets) and pipes — no ID namespacing needed since IDs are globally unique. The same `X6Canvas.reset()` path is used, so pipe routing is identical to the per-device editor.

---

## Routing (app.routes.ts)

```
/overview                              — Site listing
/site/:name                            — Site topology canvas
/site/:name/system/:config             — System editor (parent)
/site/:name/system/:config/device      — Device tab
/site/:name/system/:config/design      — Design tab (empty route, tab always mounted)
/site/:name/system/:config/automations — Automations tab
/site/:name/system/:config/timing      — Timing tab
/site/:name/system/:config/deploy      — Deploy tab
/site/:name/system/:config/docs        — Docs tab
```

The **design tab** is always mounted in the editor template (`display:none` when inactive) to preserve X6 canvas state across tab switches. Its route is an empty `{ path: 'design', children: [] }` so the router doesn't throw NG04002.

---

## Navigation Layer Colors

Each navigation depth has a unique color, defined as CSS custom properties and applied via utility classes:

```css
--nav-layer-overview: #6366f1;  /* indigo */
--nav-layer-site:     #0284C7;  /* sky */
--nav-layer-system:   #059669;  /* emerald */
```

Classes: `.nav-label-overview`, `.nav-label-site`, `.nav-label-system` (text color), `.nav-dot-*` (background color). Used in breadcrumbs, sidebar, editor header.

---

## @core

Shared library with no Angular dependency. Key exports:

- **Types:** `SiteTopology`, `Site`, `TopologyNode`, `PipeSegment`, `BoardDef`, `Route`, etc.
- **Entity registry:** `NODE_REGISTRY` — descriptors for all node kinds (tank, pump, valve, etc.)
- **Graph algorithms:** `buildGraph`, `activeGraph`, `deriveRoutes`, `buildCompositeGraph`
- **Validation:** `parseTopology`, `parseSite` (Zod schemas)
- **Codegen:** `topologyToManifest` — converts topology to deployment manifest

---

## Safety Override (firmware)

Generated firmware exposes a single template switch `safety_override` ([src/lib/codegen/generators/control.ts](../../src/lib/codegen/generators/control.ts)) wired into the runtime as a global bypass:

- **Pre-start gates** — guarded inline in `try_route_start` ([src/lib/codegen/generators/routes.ts](../../src/lib/codegen/generators/routes.ts)): `if (!id(safety_override).state && …) return FAULT;` for source-low and dest-full.
- **2 s safety monitor** — the per-slot watchdog loop in `control.ts` short-circuits with `if (id(safety_override).state) return;` at the top, so flow watchdog, runtime level stops, and per-route max runtime are all suppressed for as long as the switch is ON.
- **Pump-without-route gate** — the pump relay's `on_turn_on` handler ([src/lib/entities/pump.ts](../../src/lib/entities/pump.ts)) immediately turns the pump back off if no route owns it; this check is also skipped when `safety_override` is ON so operators can commission or bench-test the pump alone.
- **Default-safe** — declared `restore_mode: ALWAYS_OFF`; never persists across reboots.

When adding a new safety check, decide explicitly whether it sits inside the monitor loop (override-bypassable) or outside it (always-on, e.g. hardware float-switch interlocks). Document the choice on the new entity/automation.

---

## Valve actuation (firmware)

Valves are operated through ESPHome `time_based` cover entities — one cover per valve, with `open_action` and `close_action` firing the corresponding coil switch. The coil pair is hardware-interlocked (`interlock:` block in [src/lib/entities/valve.ts](../../src/lib/entities/valve.ts)) so both coils can never be energised simultaneously.

The route layer drives covers via a **level-triggered reconciler**, not edge-driven open/close calls. Every 1 s tick, `reconcile_valves` ([src/lib/codegen/generators/routes.ts](../../src/lib/codegen/generators/routes.ts)):

1. Computes `desired_valve_mask` = union of `valve_claim_mask(s)` across all slots. A slot's claim is its route's `valve_mask` while it is `PREPARING` / `RUNNING`, or while it is `STOPPING` / `FAULT` and within `DEPRESSURIZE_MS` of its `stop_time`. Outside those windows the claim is 0.
2. Diffs `desired ^ commanded_valve_mask`. `commanded_valve_mask` is updated only by the reconciler itself, so it stays a faithful proxy for ESPHome's cover state as long as nothing else drives the covers.
3. For each bit in the diff, calls `open_valve_hw(i)` or `close_valve_hw(i)` (which invoke `cover.open_cover` / `cover.close_cover` on the time-based cover). No periodic reissue — steady state is silent.

This expresses valve refcounting as a mask union: a valve stays open as long as **any** active slot claims it, and closes only when the last claim drops. The previous edge-driven model used an explicit `safe_close_mask` / `valves_closing` flag pair; the union form is simpler and harder to get wrong.

**PREPARING → RUNNING timing** waits `travel_time + 1 s` from `start_time` ([src/lib/codegen/generators/control.ts](../../src/lib/codegen/generators/control.ts)). Only on entry to RUNNING does the slot stamp `run_start_time = now` and clear `flow_confirmed`; the `flow_confirm_ms` window ([src/lib/entities/flow-sensor.ts](../../src/lib/entities/flow-sensor.ts)) is measured from that stamp, not from command issue. So the total budget before a missing-flow fault trips is `travel_time + 1 s + flow_confirm_ms` — the confirm window stacks on top of valve travel, it does not overlap it.

**STOPPING → IDLE timing** waits `DEPRESSURIZE_MS + travel_time + 1 s` from `stop_time` ([src/lib/codegen/generators/control.ts](../../src/lib/codegen/generators/control.ts)). That window covers depressurise + the actual close travel + a small safety margin, so the slot only declares itself idle once the valves have physically had time to close. The reconciler handles the close itself once the slot's claim drops at the depressurise boundary.

**FAULT path uses `stop_valve_hw`** ([routes.ts:361-365](../../src/lib/codegen/generators/routes.ts#L361-L365)) — `cover.stop_cover` — on every valve in the faulted route, immediately on FAULT entry. This force-resyncs ESPHome's internal cover position estimate before the depressurise window expires; without it, the close that follows can be filtered as a no-op when the cover already thinks it is at position 0.

**External cover writes are silent.** The reconciler never reads cover state, only writes it. If something else (a user via the dashboard, a stray automation) closes a cover during a running route, `commanded_valve_mask` does not update, the diff stays at 0, and the reconciler does not react. The route loses flow and faults via the flow watchdog after `flow_watchdog_ms`. This is the same blind spot the edge-driven model had, and it is the reason manual cover close is *not* a substitute for route-stop.

**Raw coil writes bypass the cover.** The cover's position estimate updates only when its own `open_action` / `close_action` fires; toggling `<valve> Open Coil` or `<valve> Close Coil` directly drives the coil but leaves the cover unaware. The dashboard's manual controls expose coils for diagnostics; after firing one, call `cover.stop_cover` on the same valve to resync.

When adding a new actuator (dosing pump, VFD, etc.), decide whether it fits the same level-triggered pattern (compute desired mask each tick, diff vs. last commanded, emit only on change) or whether it needs explicit edge handling. Prefer the reconciler model — it composes with multi-slot concurrency without per-slot tracking.

---

## Telemetry & coordination (soft state)

Both communication lanes — device→server (MQTT) and device→device (UDP LAN, [src/lib/codegen/generators/coordination.ts](../../src/lib/codegen/generators/coordination.ts)) — follow one model: **the periodically re-asserted full state is the source of truth; events only accelerate it.** This is level-triggered, not edge-triggered — the same principle the valve reconciler uses, applied to the wire. Because the transport is fire-and-forget (no delivery guarantee), making truth depend on a single event means one dropped packet causes permanent divergence; making truth the full state re-asserted on a timer bounds the worst case to one stale interval, never divergence.

**The contract — every telemetry field must obey all five:**

1. **Truth is full current state, re-asserted on a timer.** A change may trigger an immediate extra send to shrink latency, but losing that send never loses information — the next interval re-states it.
2. **Every field is re-asserted each interval and survives reboot.** No field may depend on an event having been delivered. (E.g. a route's `origin`/`actor` ride the snapshot every interval, not a one-shot "started" event.)
3. **Fail safe on silence.** Past the lease / staleness bound, go to the safe state — never trust last-known-good forever. (A dead-man claim whose heartbeat stops expires and the owner stops within one tick.)
4. **Idempotent; order by sequence, not arrival.** Re-applying the same message is a no-op; where ordering matters, carry a monotonic counter and compare it, don't trust arrival order.
5. **Triggered sends are rate-limited.** An immediate-on-change publish must be damped (at most one per window) so a flapping signal can't flood the lane. The periodic send stays the floor.

Same philosophy, transport-appropriate mechanism:

| | device ↔ server | device ↔ device |
|---|---|---|
| Truth | one `ControllerSnapshot` re-asserted every interval ([src/lib/codegen-ids.ts](../../src/lib/codegen-ids.ts)) | granular `claim` / `reading` messages, re-asserted every 10 s |
| Freshness / safety | MQTT retained + last-will (online/offline) + snapshot `ts` | 90 s app-level dead-man lease |
| Ordering | n/a (single latest doc) | per-sender monotonic counter `c` (also anti-replay) |

**Attribution rides this model.** A route's `origin`/`actor` is bound to the route's *state* on the device and re-asserted every snapshot, kept until the next transition rebinds it (per-transition: a manual stop of an automation run reports the stopper). The server records it onto each derived `state_events` row at ingest ([maji-server/internal/telemetry/ingest.go](../../maji-server/internal/telemetry/ingest.go)) — it is a pure recorder, it never invents attribution. The activity timeline then shows "who" for routes the same way the commands ledger does for node actions.

Attribution is *live state*, not reboot-persisted: a reboot clears the slots, so a route that was attributed pre-reboot reports `SYSTEM`/idle until it next runs. That's correct — there is no live run to attribute — and the historical attribution already lives in the server's `state_events`. This is the one field exempt from "survives reboot": there is nothing to survive once the run is gone.

**Deliberately out of scope (avoid over-engineering):**

- **No `origin`/`actor` on the UDP claim lane.** When controller A's automation drives B's pump, the *route* (with attribution) lives on A and reaches the dashboard via A's own snapshot; the claim B receives only needs "A wants this node held." Adding attribution to claims is redundant until a device needs a *local* who-based decision.
- **No flash-persisted replay counter.** The 90 s lease already bounds a replayed claim to one lease of an intent the importer recently held; claims are not secret. Persisting the counter across reboots buys little against that.
