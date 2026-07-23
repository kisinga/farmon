# Partner Portal — Implementation Spec

**Status:** ready for implementation
**Feature flag:** `partner_portal` (seeded disabled, migration 54)
**Builds on:** `partners` org collection (migration 55), partner role + org-scoped guards (`users_hooks.go`, `requireSiteAccess`), `/branding` endpoint, MANAGER-role pages (`/overview`, `/customers`, `/devices`)

## 0. What this is

A self-serve home for partner organizations (resellers/installers who manage customer sites). Partners today can already reach the shared MANAGER pages scoped by collection rules — but there is no aggregated "my business" surface, no self-serve org profile, and no guided customer onboarding. This spec adds those three, nothing more. It deliberately does NOT rebuild pages partners already have.

## 1. Current state (verified, do not rebuild)

- `partners` collection: name, slug, logo, brand_primary, brand_accent. **Admin-only API rules** — a partner cannot read their own org record (the `/api/farmon/branding` endpoint exists precisely to work around this).
- `users.partner` → partners (single), `sites.partner` → partners (multi, auto-mirrored from owners' orgs by `recomputePartnerSet`).
- Collection rules scope partner reads to their org's customers and those customers' sites; `users_hooks.go` lets partners create/update only `role=customer` users in their own org, no role escalation, no partner reassignment.
- `/overview` (sites catalog), `/customers` (customer accounts), `/devices` (fleet) already serve partners correctly scoped.

## 2. Scope

### 2.1 Partner home (`/partner`) — the missing aggregate

One page answering "how is my whole fleet?":

- Customer count, site count, controller count (live vs offline, from `sites.device_count`/`live_count` — already denormalized).
- Sites table: name, customer (owner), live/offline, active alerts count, last activity — scoped by the existing `sites.partner` rule, no new backend.
- Recent alerts/incidents across the org's sites (`notification_incidents` — rule already allows it via 49/55, see §3.1).
- Entry point: `home` route sends partners here instead of `/overview` (admins unchanged).

### 2.2 Self-serve org profile (`/partner/org`)

- `GET /api/farmon/partner/org` — own org record (name, slug, logo_url, brand colors).
- `PATCH /api/farmon/partner/org` — name, brand_primary, brand_accent; logo upload via multipart (reuse the firmware-upload pattern: server-side type/size check, 2 MB, image mime only).
- Both: auth + `role=partner`, org resolved from `e.Auth.partner`, never from the body. Collection rules stay admin-only; these routes are the only partner path (same pattern as `/account` for users).
- Branding propagation already works (`/branding` serves the org's logo/colors to any user whose `partner` points at it) — verify a customer's UI reflects an updated logo without code change; document.

### 2.3 Customer onboarding (`/partner/customers/new`)

Guided version of what partners can already do by hand:

- One form: customer name + email → creates the `users` row (role customer, partner = caller's org) and optionally a first site (owner = new customer). Reuses existing guarded collection writes — no new backend routes, just a wizard UI calling the same endpoints.
- Temporary password generated client-side, shown once, with "customer must change it" copy. (Invite-by-email flow needs SMTP-backed invite tokens — deferred, see §5.)

### 2.4 Read-only drill-down

From the sites table, a partner opens the customer site's dashboard (`site/:name/dashboard`) — works today via `requireSiteAccess`'s partner clause. No edit surfaces added: partners manage, customers operate.

## 3. Backend changes (small)

### 3.1 Rule/endpoint deltas

- New `internal/api/partner_routes.go`: `RegisterPartner(se)` mounting `/api/farmon/partner/org` GET/PATCH (+ logo POST). Wired in `server.go` beside `RegisterBilling`.
- `notification_incidents`: the partner read clause (`(@request.auth.partner != "" && site.partner.id ?= @request.auth.partner)`) already exists via the 49/55 rule chain, so the partner home can aggregate incidents without a rule change. Migration 62 only checkpoints the rule (byte-identical no-op, kept for numbering); the migration that changes effective access is 63, which restricts the clause to `role = "partner"` (customers carry `users.partner` too — the unguarded clause leaked the whole org's incidents to any customer). Read-only either way; writes stay server-side.
- No migrations required. (If the sites table needs per-site last-activity, it's `sites.updated` — good enough; do not add fields.)

### 3.2 What is NOT changed

- No change to site ownership, guards, or the entitlement model.
- Partners still cannot: grant entitlements, see other orgs' data, manage admin users, or access billing config beyond what site access already grants.

## 4. Frontend changes

- Routes (`app.routes.ts`): `/partner`, `/partner/org`, `/partner/customers/new` — `roleGuard` partner-only + `featureGuard` with `data: { feature: 'partner_portal' }`.
- Shared dashboard primitives (shipped with the dashboard rework): the partner home MAY render as a widget grid using `src/app/widgets/` (registry/grid/layout) with `dashboard_layouts.key = 'partner-home'` and `site` empty — the collection and services already support it; a plain composed page is equally acceptable for v1.
- `home` component: route partners to `/partner` when the flag is on (flag off → current `/overview` behavior).
- New components under `src/app/pages/partner/`: home (stats + sites table + incidents), org profile (form + logo preview), customer wizard. Reuse existing table/form/card idioms from `/customers` and `/settings`; branding preview uses `BrandingService`.
- Nav: partner sees Partner / Overview / Customers / Devices / Account; the Partner entry is flag-gated.

## 5. Explicitly out of scope (v1)

- Email invite/verify flow for new customers (needs token infra; manual password handoff for now).
- Partner commercial reporting (commissions, per-partner revenue, subscription management) — requires a product/pricing decision first (`docs/PRICING_PLAYBOOK.md`).
- Partner-scoped billing administration (tenant_billing belongs to the site owner; partners get read visibility only through existing site access).
- Multi-org users (a user belongs to exactly one org — `users.partner` is single-select).
- Partner-managed admins (org members are created by platform admins, not self-serve).

## 6. Testing + acceptance gates

1. `partner_routes_test.go`: partner reads/updates own org; cannot read another org (404/403); logo upload rejects >2 MB and non-image; customer role cannot call `/partner/org`.
2. Incidents rule: partner sees incidents only for sites whose `partner` contains their org.
3. Wizard e2e (ApiScenario): partner creates customer → customer logs in → sees only their own site.
4. Frontend: `ng build` clean; flag off hides all `/partner` routes and the nav entry.
5. `go test ./... -race` green.

## 7. Delivery order

1. `partner_routes.go` + tests → 2. partner home page (read-only aggregate) → 3. org profile + branding verify → 4. customer wizard → 5. nav/home routing + flag flip for a pilot partner.
