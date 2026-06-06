# MajiFlow — remaining work

What's **left**. For the system as built (stack, invariants, gotchas, env, what's done),
see [built.md](built.md). Full roadmap: `~/.claude/plans/based-on-all-of-splendid-zebra.md`
(Plan 0 Phase B is the current focus). Branch `major-refactor`, updated 2026-06-06.


## Plan 3 Phase 2 — on-prem (not started)

On-prem sites are **not routed through our servers** (decision 2026-06-06). Offsite access is
the customer's own VPN (e.g. WireGuard/Tailscale) into their box — we never proxy their
traffic or hold their keys. This drops the former cloud-tunnel/proxy + confused-deputy guard
work entirely.

- **On-site box runs standalone** — broker + DB + dashboard on the LAN; controllers
  coordinate directly; whole site keeps running with the cloud/internet down.
- **Offsite access = customer VPN** — documented setup, not a service we host.
- **Offline / LAN access** — box serves the app on the LAN; break-glass local account.

## Commissioning & hosting (managed) — not built

- **`sites.commence_date`** — stamp on first controller provision (the billing anchor for
  managed hosting); migration + set in the `/provision` handler if unset; surface in admin.
- **Per-site device cap** — managed hosting is per site, **up to 5 devices, $4k/year**;
  enforce the 5-device cap at provision and show usage/renewal in the admin site view.
- On-prem/custom sites carry no hosting clock (standalone, customer VPN).

## Smaller / deferred

- **Tests (tests-last):** repoint the stale harness off deleted `electron/` paths; add the
  cross-language wire-contract round-trip (Go ACL/ingest vs core topic layout).
- **Dosing-pump owner-side actuation** — pre-existing gap; the dosing claim currently no-ops
  on the owner (not wired into pumps or the valve reconciler).
- **HA-cruft pass** — prune the now-dead `api_watchdog` config field, `SYS.apiWatchdog`/
  `apiPartitioned`, `api_key` secret, orphaned `safetyProfile.deadMan*` fields, deep
  `ha.ts`/`ha-meta` exports.
- **Plan 2 leftover** — the Design-canvas topology-sidebar bespoke polish (deferred to its
  own session).
- **Guided-design wizard** — its own future plan (relationship-input onboarding for lite).
