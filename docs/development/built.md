# MajiFlow — what we built (system reference)

How the system stands today. For what's **left**, see [status.md](status.md); for the
roadmap, `~/.claude/plans/based-on-all-of-splendid-zebra.md`; for the why/lessons,
[journal.md](journal.md). Branch `major-refactor`, updated 2026-06-06.

## Stack

- **Angular 21 web app** (admin + customer) — designs a site's topology, validates it,
  generates ESP32/**ESPHome** firmware **in the browser**, shows the live dashboard.
- **Go server** (`maji-server`) — PocketBase-as-library (SQLite, auth, files, serves the
  SPA) + an **embedded Mochi MQTT broker**. Domain-agnostic. Two builds, shared
  `internal/`: `cmd/cloud` (managed) + `cmd/edge` (local), split by build tags.
- **Firmware** — ESPHome YAML+headers generated client-side from `@far-mon/core`,
  compiled manually (`esphome compile`), pushed OTA.
- Core in `src/lib` (imported as `@core` / `@far-mon/core`) = single source of truth for
  topology → manifest → codegen, run in the browser.

## Architecture invariants (the hard rules)

1. **Transport split.** MQTT is the **device↔server pipe ONLY** (telemetry up, commands
   down). **ALL** cross-controller traffic — actuator claims AND remote sensor reads — is
   **direct LAN UDP** (ESPHome `udp:` `on_receive`/`udp.write`, HMAC-SHA256 over a
   per-site `udp_key`). MQTT never carries device↔device traffic.
2. **Generic reactive owner.** A controller honours a claim from *any* sender (claimant id
   in the payload `from`). Adding a claimant flashes only the new controller, never the
   owner. No peer enumeration, no `exports` list.
3. **One arbiter per actuator.** The owner's 1Hz reconciler is the sole writer of its
   relays; routes/schedules/claims/manual are intent sources. A claim is a **lease** (90s,
   renewed ~10s); expiry stops the actuator → fail-closed, no split-brain.
4. **DB is the source of truth.** Devices publish → server stores → UI reads. Customers
   never touch MQTT.
5. **Server is a dumb, secure pipe** — never reads a topology or generates firmware.
6. **Firmware is mode-uniform.** `mode` (managed|local) only picks the broker + server
   build (deployment concern), not behaviour. Cross-controller works in both.
7. **No stored wifi passwords** — wifi via device captive portal → NVS. Generated secrets:
   `ota_password` (stable, per-controller), `mqtt_token` (rotates, per-controller, only
   hash stored), `udp_key` (per-SITE, shared by its controllers).
8. **Ethernet XOR WiFi** — one transport, never both.

## Provisioning & deploy workflow (required to put a controller online)

This is the only path that makes a device acceptable to the broker — provisioning is a
server write, not just codegen.

1. **Design** the topology in the editor (autosaves a draft).
2. **Generate** firmware (`BackendService.generate`) — first calls **provision**:
   `POST /api/farmon/provision {site, controller, name?, board_type?}`, admin/owner-gated.
   The server ([routes.go](../../maji-server/internal/api/routes.go)):
   - upserts the `controllers` row by `device_id` (first call → create);
   - mints a **fresh MQTT token every call**, stores only its bcrypt `token_hash`;
   - mints `ota_password` **once and reuses** it (stable, so a new build can OTA the
     already-running device);
   - mints a **per-SITE `udp_key` once** on the `sites` record and reuses it (shared by
     every controller on the site);
   - **stamps `sites.commence_date` on first commission** (first controller provisioned) if
     unset — the anchor the hosting-billing clock counts from (see Commissioning & hosting);
   - returns `{token, ota_password, udp_key}` raw, once.
3. The browser **bakes** those into this build's `secrets.yaml` (`mqtt_token`,
   `ota_password`, `udp_key`). Wifi is **not** baked — captive portal → device NVS.
4. Generate the ESPHome bundle (`device.yaml` + `packages/*` + headers + `secrets.yaml`),
   **download** the zip.
5. `esphome compile` **manually** → flash over USB (first time) or **OTA** (subsequent,
   using the stable `ota_password`).
6. Device connects to the baked broker as `username = device_id` + the raw token; the
   broker's `OnConnectAuthenticate` verifies `username == device_id` against `token_hash`.
   The `udp_key` authenticates LAN cross-controller coordination.

Invariants: MQTT token **rotates** every build (only the hash is stored); OTA password is
**stable**; `udp_key` is **per-site, shared**. (Deferred original full flow — generic
pre-flash + runtime call-home + printed claim code — earns its keep only for local/fleet
images that can't know their identity at build time.)

**Commissioning & hosting (managed).** Commissioning a site = its **first** controller
provision; that stamps a per-site **`commence_date`**, which is the billing anchor for
managed hosting. Hosting is priced **per site, up to 5 devices, at $4k/year** (the managed
product — see [[project_pricing_model]]). The cap and the renewal date both derive from the
site row (`commence_date` + controller count), so billing/limits are a site-level concern,
not per-device. On-prem/custom sites are standalone (customer VPN, no cloud hosting) and
carry no hosting clock.

## Proven live on hardware

- **Managed, single controller**: device → MQTT → broker → DB → dashboard, controller
  `online=1`. Real KC868 (ethernet board).

## Done & committed

- **Rebuild (Plan 3) Phase 1 — managed end-to-end:** firmware MQTT, server shadow +
  `state_events`, provisioning (baked identity), ECharts dashboard, login/roles, HA fully
  removed from firmware (on-device scheduler + always-on `web_server` portal replace it).
- **Admin monitoring (Plan 1):** read-only + take-control, `issued_role` audit.
- **Dark redesign + per-section routes (Plan 2):** committed `0929602`.
- **Offline-first Phase A:** manual control (`node_set`), command TTL, real device
  presence — build-validated.
- **UDP cross-controller (Plan 0 Phase B):** committed **`39698cc`**. New
  `src/lib/codegen/generators/coordination.ts` (C++ HMAC dispatcher + `udp:` YAML),
  `remote-proxy.ts` importer `udp.write` claims, MQTT peer lane deleted, broker ACL locked
  to own-namespace+esphome, per-site `udp_key` (migration 11), cross-controller validation
  rule deleted (legal in both modes).

## Divergences from the original plan (`temporal-riding-summit.md`)

- **Monorepo flattened** — plan keeps `packages/core/`; inlined to `src/lib` (`@core`) in
  `dde8604`. Plan's `packages/core/src/...` paths are STALE.
- **Tiers** `lite|pro|custom` → collapsing to 2 (lite + on-prem custom).
- **Provisioning grew** beyond "one-time token" → `{token, ota_password, udp_key}` +
  no-stored-wifi captive-portal flow.
- **Cross-controller** — the original has NO peer model (only a Pro tunnel +
  telemetry-only bridge). The entire UDP coordination layer is a later invention; the
  original's "single control path" rule was about tunnel-vs-bridge, not peers.
- **HA already gone** by Jun 3 — the journal's "March HA pivot" was abandoned within weeks.

## Gotchas (hard-won)

- **UDP send must use the `udp.write` action**, never `id(coord_udp).send_packet(...)` in a
  lambda. The action's codegen calls `set_should_broadcast()`, which makes
  `UDPComponent::setup()` create the broadcast socket. Bypass it → `send_packet` derefs a
  NULL `broadcast_socket_` → panic → **reboot loop** (relays flashing).
- **Route dedup is a smell** — the NG0955 duplicate-route bug was fixed at the root
  (pressure sensor folded into the tank; migration reconnect-unless-exists), not a dedup pass.
- **`udp:` `on_receive` does not expose the sender** — claimant id is in the payload `from`;
  we HMAC ourselves (the component's `encryption`/`rolling_code` are relocated to
  `packet_transport`, not on the raw path).
- **Same L2 broadcast domain required** for UDP coordination (AP/client isolation OFF);
  it does NOT use mDNS (broadcasts to 255.255.255.255).

## Toolchain / env

- node `$HOME/.nvm/versions/node/v24.12.0/bin`; go `/usr/local/go/bin`; esphome 2026.3.1
  (pipx venv, python `/home/kisnga/.local/share/pipx/venvs/esphome/bin/python`).
- Device on USB: `/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0` → `ttyUSB0` (CH340,
  KC868_A16 ethernet board).
- Verify gate: `npx tsc -p tsconfig.app.json --noEmit` · `ng build` · `go build` cloud+edge
  · `esphome config` / `esphome compile`. Tests are last.
