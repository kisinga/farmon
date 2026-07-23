# Dashboard Rework — As-Built Spec

**Status:** shipped (uncommitted as of writing). The rework **replaced** the old dashboard outright — no backward compatibility, no permanent flag. The `new_dashboard` feature-flag row remains in the DB but is unused.
**Builds on:** `buildDashboardSpec` (`src/lib/dashboard-spec.ts` — unchanged), `packs.widget_ids` (migration 34 — now consumed), `dashboard_layouts` (migration 61).

## 0. What this is

One dashboard shell serves both the cloud app and the on-device app. Widgets come from a registry, placement from a stored layout falling back to a curated auto-derived default, and the presentation is state-driven (an attention banner surfaces what needs eyes; a calm system renders calm).

The hierarchy that guides the default layout (product decision, not user research):

1. **Routes** — "is water flowing, and what can I start/stop?" The verbs.
2. **Map** — the live topology. Desktop-only.
3. **Status & controls** — tanks/valves/pumps in ONE zone (status and manual control are two views of the same node). Default-hidden on desktop — the map already shows levels/valve states (the old `MAP_ABSORBS` rule); visible on phone as the map's substitute. The picker can always un-hide.
4. **Trends** — flow/pressure charts (cloud).
5. **Usage** — totals + billing widgets (cloud, entitlement-gated).
6. **System** — activity timelines, health history.

## 1. Architecture

### 1.1 Widget registry (`src/app/widgets/registry.ts`)

`WidgetDef { id, title, capability?, cloudOnly?, defaultVisible, defaultWidth }` — pure TS, no Angular. `filterByEntitlement` drops defs whose `capability` isn't granted; `filterForBuild` drops `cloudOnly` defs in the device build (one filter point replacing the old dashboard's scattered `@if (!deviceMode)` branches). The concrete def table is `src/app/pages/dashboard/widget-defs.ts`; the instance→component mapping is the `WidgetRender` union in `src/app/pages/dashboard/widgets.ts`. (Originally spec'd as `src/lib/dashboard/registry.ts` — moved: `src/lib` is the device-shared domain layer and the registry is a UI concern.)

### 1.2 Stored layout (`dashboard_layouts`, migration 61)

Fields: `key` (e.g. `'site-dashboard'`; `'partner-home'` reserved for the partner portal), `site` (rel, optional), `user` (rel, optional — empty = shared site default), `layout` JSON. Unique `(key, site, user)`. Resolution: user row → site default → auto-derived. Per-user layouts are self-service for any viewer with site access; the site default is owner-written (enforced by collection rules). `layout.ts` pure helpers: `parseLayout` (any corruption → null → derived fallback), `resolveLayout` (stored wins; new derived instances append), `pickEffectiveLayout`, `moveItem`, `cycleWidth`.

**Section labels** ride the curated default only (`LayoutItem.section`): `serializeLayout` and `resolveLayout` strip them — once the operator owns the order, zone labels would lie.

On-device: `DeviceLayoutService` (provider swap in `device.providers.ts`) persists to localStorage only; the site-default affordance hides.

### 1.3 Renderer (`src/app/widgets/widget-grid.component.ts`)

Hand-rolled CSS grid + pointer events (no new dependency): 12-col ≥1024px, 4-col 640–1023px (w12→4, w6→2, w4→2), 1-col phone. Read mode renders in order at `span w`; edit mode (≥640px only) adds drag-reorder (pointer capture, nearest-centre drop target), a width cycle (⅓/½/full) and hide; the shell's picker panel re-shows hidden widgets. Dumb by design — the parent owns per-instance rendering via one `ng-template`.

### 1.4 Entitlements

`GET /api/farmon/sites/{id}/capabilities` → `{ capabilities, widget_ids }` — resolved by `internal/entitlements` (`Set`), the single evaluator; `billing.HasCapability` is a thin wrapper over it. Frontend: `CapabilitiesService` (tri-state per-site cache; skips the fetch and returns empty on-device).

### 1.5 The shell (`src/app/pages/dashboard/dashboard.component.ts`)

- Page-scoped `DashboardStore`/`TelemetryStore`/`CommandLifecycleStore` — same stores as the old dashboard, so the shared widgets work unchanged.
- **Attention banner** above the grid: route faults (with decoded reason), offline controllers, live safety override. Absent when calm.
- Zones per §0 via `buildDefaultLayout(spec, defs, { mobile })`; `mobile` = viewport <640px at load (SSR defaults to mobile, matching the old cards-default).
- Edit mode: per-user Save, owner "Set as site default" (cloud), Reset to default.
- Header: controller health, site controls (Automations + Setup — Setup now works on-device), Billing link + Docs (cloud-only), Customize (≥640px).

## 2. Billing/metering widgets

- `billing-outstanding` (w6): site outstanding total + overdue count → `/billing`.
- `meter-valve` (w6): per claimed meter — valve state, last reading, last contact, queued-command badge with the mandated "pending — applies at next meter contact (up to 24h)" copy → `/billing/meters`.
- Both `capability: 'tenant_billing'`, `cloudOnly: true`, in the Usage zone.

## 3. Compatibility (what "replace" meant)

- The old `dashboard.component.ts` is deleted; its widgets/stores/canvas stayed as the shared layer both builds use. The `canMatch` guard, the `?newdash` override and the v2 folder are gone.
- The device build adopted the same shell: provider seam swaps network surfaces (existing pattern) + layout persistence (new `DeviceLayoutService`); `cloudOnly` registry filter drops what the device can't back. Device bundle cost: ~+23KB raw total.
- No data migration: absence of `dashboard_layouts` rows = the curated default.

## 4. Explicitly out of scope (v1)

Free-form widget config; multi-dashboard tabs; cross-site fleet view (partner portal's job); export/sharing; phone drag-editing (phone is read-only layout); **map hover enrichment** (richer tank/node info on hover — noted follow-up, canvas work).

## 5. Testing

Pure tsx suites: `test/dashboard-registry.test.ts` (entitlement + build filtering, billing contract), `test/dashboard-layout.test.ts` (parse/resolve/sections/pick), `test/dashboard-default-layout.test.ts` (golden topology → zones, absorption, mobile map rule, billing gating). Backend: `internal/entitlements` + `internal/api/capabilities_routes_test.go` + migration 61 assertions in `migrations_test.go`. `npm test`, `ng build` (dev + device) and `go test -race` are the gates.

## 6. Mobile

First-class: 1-col grid, map hidden by default (node cards substitute), Setup modal is a full-screen sheet with 44px+ touch targets (settings rework), phone gets no edit affordances. A visual pass on a pilot site is the remaining manual check.
