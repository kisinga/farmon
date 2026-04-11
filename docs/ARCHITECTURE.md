# MajiFlow Architecture

## Overview

MajiFlow is a water network design tool. Users create **sites** (a physical location), add **systems** (individual ESP32 controllers), design each system's **topology** (tanks, pumps, valves, sensors connected by pipes), then generate and deploy ESPHome firmware + Home Assistant dashboards.

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
- **Electron** — desktop shell, file I/O, ESPHome CLI integration
- **@far-mon/core** — shared TypeScript library (types, graph algorithms, codegen)

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
- **ElectronService** — thin IPC wrapper, no state

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

## @far-mon/core

Shared library with no Angular dependency. Key exports:

- **Types:** `SystemTopology`, `Site`, `TopologyNode`, `PipeSegment`, `BoardDef`, `Route`, etc.
- **Entity registry:** `NODE_REGISTRY` — descriptors for all node kinds (tank, pump, valve, etc.)
- **Graph algorithms:** `buildGraph`, `activeGraph`, `deriveRoutes`, `buildCompositeGraph`
- **Validation:** `parseTopology`, `parseSite` (Zod schemas)
- **Codegen:** `topologyToManifest` — converts topology to deployment manifest
