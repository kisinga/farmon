# Shengda Meter Integration + Billing — Implementation Spec

**Status:** implemented (backend + dashboard); live-device validation pending sample meters
**Companion doc:** `docs/billing-module-architecture.md` (domain model, billing engine, payments, notifications, authz — follow it except where this spec overrides)
**Vendor docs:** `docs/vendor/shengda-udp-protocol.pdf` (protocol, authoritative), `docs/vendor/shengda-nbiot-meter-manual.pdf` (hardware)

> **Implementation notes (folded back after the build):**
> - **CRC16 resolved:** AUG-CCITT (CRC-16/SPI-FUJITSU: poly 0x1021, init 0x1D0F, non-reflected, no xorout), CRC bytes big-endian, computed over the full frame minus the 2 CRC bytes. Locked by `internal/metering/codec_test.go`.
> - **Fixture typo corrected:** the time-calibration hex below originally carried an extra `62` byte before `bn` (provably wrong: the frame's own length field 0x0025 and the CBOR structure both reject it). Corrected here.
> - **Dedupe key:** readings dedupe on `(meter, message_id, device_ts)`, NOT `(imei, message_id)` — the wire's message ID is a random 16-bit value and collides on its own within a few hundred uplinks.
> - **Units:** readings are stored as integer **millilitres** (`cumulative_ml`) per the architecture §5 invariant; the wire's litres are converted at ingest.
> - **Naming:** the `meters` collection of §6 is `meter_devices` (architecture §4.2 name) with the fields below.
> - **Migrations:** landed as 57 (billing core), 58 (metering), 59 (financial spine).
> - **Gating is two-layer:** the global `billing_module` feature flag (migration 54 kill-switch) PLUS per-site `tenant_billing` capability from `sites.addons`/`packs.capabilities`, evaluated server-side by `billing.HasCapability`; entitlement fields are admin-only writes again (`guardEntitlement*` in `sites_hooks.go`).
> - **Listener lifecycle:** the UDP listener starts only on the cloud binary when `MAJI_METER_UDP_ADDR` is set (empty = disabled); `MAJI_METER_TZ` (default `UTC+3`) configures the time-calibration timezone. Port 5683 is also CoAP's IANA port — the vendor chose it; no CoAP is involved.
>
> **Hardening pass (post-review, folded back):**
> - **Command attempts cap:** `meter_commands.attempts` counts sends; ack-timeout requeues stop at the site's `billing_settings.cmd_max_attempts` (per-site DB policy, default 3, takes effect immediately — not env) → status `failed` + critical `meter_events` row + `alerts.SendExternal` to site owners. Migration 64 also adds `ack_raw` (hex of the ack payload, audit); migration 65 adds the settings field.
> - **Orphaned `sent` sweep:** at listener startup, `ExpireOrphanedSent` expires all `sent` commands — a `sent` row from a previous process is unackable (the pending-ack map is in-memory) and would otherwise deadlock valve control for that meter (`HasPendingValve` counts `sent` as pending while `flushOne` only dequeues `queued`).
> - **Ack verification:** `resolveAck` decodes the FuncCmdResult payload; a `/81/0` key-0 echo contradicting the commanded state fails the command (no `valve_state` update) instead of acking it. Acks without a valve echo still pass (live-device validation pending).
> - **Pending-valve race closed:** partial unique index `idx_meter_commands_pending_valve` on `meter_commands(meter) WHERE status IN ('queued','sent') AND type IN ('valve_open','valve_close')`; `EnqueueValve` maps the violation to `ErrValvePending`. Note PocketBase surfaces unique violations as validator errors ("Value must be unique"), not raw SQLite strings.
> - **Arrears intent/fact split:** `invoices.closed_at` = "closure initiated" (intent, set once); physical state is per meter (`valve_state` + pending commands). The sweep no longer skips closed invoices — it retries every un-closed meter until closed/pending (fixes permanent partial close), and reopen clears `closed_at` only when every meter is reopened/in-flight. A queued-but-undelivered `valve_close` is superseded by payment: the reopen path cancels it (`metering.PendingValve`) so a settled tenant's valve never closes on the next contact; a close already sent can't be cancelled safely and keeps `closed_at` set.
> - **Billing routes are owner-only:** partners pass `requireSiteAccess` but billing routes use `requireSiteOwnership` (admin or site co-owner), matching the owner-only collection rules. Partners set up sites; they never see billing data.

## 0. What this is

Path A: enterprise water billing. Battery-powered Shengda ultrasonic meters (NB-IoT / 4G Cat.1, DN20 brass, built-in motorized valve) report cumulative consumption to maji-server over raw UDP. maji-server bills tenants and can close/open the meter valve on arrears/payment. No field controller involved. This does not touch ESP32/firmware/codegen.

## 1. Overrides to the architecture doc

1. **§6 (MQTT ingestion) is replaced** by the UDP/CBOR ingestion in §3 below. Meters do not speak MQTT. Domain model (§4), billing engine (§7), payments (§8), notifications (§9), API (§10), authz (§11) stand as written.
2. **"Out of scope: remote disconnection" is now IN scope.** The meter's built-in valve is the differentiator. See §5.
3. Architecture doc assumed secure MQTT device auth. UDP has none — see §4.7 (identification/trust).

## 2. New packages

```
maji-server/internal/metering/
  codec.go        — frame parse/build, CRC16, CBOR decode/encode
  codec_test.go   — fixtures from vendor PDF (§3.4)
  objects.go      — LwM2M-style object model (/3/0, /80/0, /81/0, /84/0, /99/0) + key maps
  listener.go     — UDP socket, packet loop, session tracking
  session.go      — per-device 20s downlink window state machine
  commands.go     — downlink command queue (48h TTL, one-at-a-time, ack tracking)
  ingest.go       — reading persistence, dedupe, raw log
  valve.go        — open/close command builders + arrears rule hooks
```

Add dep: `github.com/fxamacker/cbor/v2`. No other new deps without asking.

## 3. Protocol (from `docs/vendor/shengda-udp-protocol.pdf`)

### 3.1 Frame format

```
0101            fixed header
<1B>            message type: 00=uplink, 02=response/time-calib
<1B>            function code (uplink=02, control=03, time-calib=45(0x2D→see PDF, use 69 dec), response=44(0x2C→68 dec))
<2B>            message ID, random 1-65535
3c              format: CBOR
<2B>            data field length
ff              delimiter
<CBOR bytes>    data domain
<2B>            CRC16
```

**CRC16 variant:** ~~unspecified in the PDF~~ **resolved: AUG-CCITT (CRC-16/SPI-FUJITSU)** — poly 0x1021, init 0x1D0F, non-reflected, xorout 0; CRC bytes big-endian; computed over the full frame minus the 2 CRC bytes. Determined by brute-forcing common CRC-16 params against the §3.4 fixtures; locked by unit test.

### 3.2 CBOR payload model

Array of maps. Each map has `"bn"` (base name) + integer keys:

| bn | meaning | keys seen |
|---|---|---|
| `/3/0` | device info | 2=SN (string), 13=unix ts, 14=tz e.g. "UTC+8", 1=ICCID?, 18=protocol ver, 19=firmware ver |
| `/80/0` | meter | 0=model string, 16=cumulative reading (litres), 21=reading ts, 2=PN (L/pulse), 7=max reading |
| `/81/0` | valve | 3=state (1=open per example; verify), 1/2=position detect |
| `/84/0` | reporting | 0=interval secs (86400 default), 5=reporting window |
| `/99/0` | network | 1=IMEI, 11/13/14=signal metrics (rsrp/snr — semantics unverified) |

**Keys marked "unverified" must be stored but not trusted.** Every uplink's decoded CBOR is persisted raw (JSON) alongside parsed fields so unknown semantics are never lost.

### 3.3 Interaction sequence (session)

1. Device wakes (schedule or button), sends uplink from random port. Capture source IP:port — valid for this session only.
2. **Immediately** reply with time-calibration (type=02, func=69, payload `[{2:"<SN>",13:<now>,14:"UTC+3",25:1,bn:"/3/0"}]`). SN must match the device's reported SN or it ignores the packet. No response expected.
3. Flush command queue: send ONE pending command (type=00, func=3), payload `[{<key>:<value>,22:"<IMEI>",bn:"<target>"},{2:2018,bn:"/70/0"}]` (the `/70/0` trailer is a fixed constant).
4. Wait for execution result (type=02, func=68, echoes new param values). On ack → next queued command. On timeout (suggest 8s, hard cap 20s from uplink) → session over, command stays queued for next window.
5. Commands expire unsent after 48h (vendor cache semantics) → status `expired`, alert operator.

### 3.4 Test fixtures (verbatim from vendor PDF — build codec tests from these)

Uplink:
`01010002cfbd3c00bcff86ab62626e642f332f3002693132333435363738390d1a64351eb70e655554432b3801634e426807190168110112655056332e30136c56332e30305f32313031303414001700a662626e652f38302f3000664c58432d323001020600101a0098967f151a64351eb7a462626e652f38312f30030101000201a362626e652f38322f3000000100a262626e652f38342f30001a00015180a562626e652f39392f30016f3836373732343033313736383430380b39040f0d39035b0e381fda50`

Time-calib downlink (corrected — the original transcription had an extra `62` before `62626e` ("bn"); the length field `0025` only admits 37 payload bytes):
`01010245fb6e3c0025ff81a502693132333435363738390d1a6965eb8e0e655554432b3818190162626e642f332f30a487`

Close valve: `0101000351d53c002cff82a30001166f38363737323430333137363834303862626e652f38312f30a2021907e262626e652f37302f3049fb`

Open valve: `01010003c4a23c002cff82a30000166f38363737323430333137363834303862626e652f38312f30a2021907e262626e652f37302f301072`

Command result: `01010244dd6e3c005dff84a262626e652f37302f30021907e2a762626e652f38302f3000664c58432d32300102020206001000151a64351ad2a262626e652f38342f300000a462626e652f39392f30016f3836373732343033313736383430380d3902a80e381d48e9`

Expected decodes are in the PDF; e.g. close-valve CBOR = `[{0: 1, 22: "867724031768408", bn: "/81/0"}, {2: 2018, bn: "/70/0"}]`.

## 4. Ingestion service

Config: `MAJI_METER_UDP_ADDR` (default empty = **disabled**; set `:5683` on the cloud deployment only), `MAJI_METER_CMD_WINDOW_MS` (default 8000), `MAJI_METER_CMD_TTL_H` (default 48), `MAJI_METER_TZ` (default `UTC+3`, stamped into time-calibration replies). The listener runs on the cloud binary only.

1. **Listen** on UDP. Parse frame (§3.1); reject bad CRC/short frames, log, continue.
2. **Identify** meter by IMEI (`/99/0` key 1) and/or SN (`/3/0` key 2). Unknown device → create `meter_sightings` record (raw payload, source IP) for operator claiming; do not fail.
3. **Dedupe** on `(meter, message_id, device_ts)` — unique index; replays return a no-op. (Not `(imei, message_id)`: message IDs are random 16-bit and collide.)
4. **Persist**: `meter_readings` (meter, cumulative_ml — wire litres × 1000, device_ts from `/80/0` key 21, received_at, message_id, signal json, raw_cbor json, raw_hex). Reading feeds billing engine per architecture §7.
5. **Update meter**: last_uplink_at, valve_state (from `/81/0`), battery/signal where decodable.
6. **Run session** per §3.3 (time-calib + command flush).
7. **Trust**: no auth exists at this layer. Accept that v1; mitigate by (a) only acting on devices claimed to a site, (b) valve commands require the IMEI the device itself reported, (c) alerting when a known IMEI appears from a new source IP range. Document as accepted risk.

## 5. Valve control + arrears automation

- `meter_commands` collection: meter, type (`valve_open|valve_close|set_interval|calibrate|read_frozen`), payload json, status (`queued|sent|acked|failed|expired`), queued_by (user|rule), created/sent/acked_at, error.
- Dashboard: manual open/close with typed confirmation + audit log entry.
- **Arrears rule** (per site, configurable): invoice overdue > grace_days → send warning notification (existing WhatsApp/email alerts infra) → after warn_days still unpaid → queue `valve_close`. Payment covering arrears → queue `valve_open` + notification. Never close without prior warning; never auto-close when valve_state already closed; rule is idempotent across restarts.
- Valve state shown in dashboard with "pending — applies at next meter contact (up to 24h)" copy. Latency is inherent (meter sleeps); UI must never imply instant action.

## 6. Data model additions (migrations, PocketBase-style per `maji-server/migrations`)

- `meter_devices`: site, unit (rel per architecture §4.1), imei (unique), sn, model, comm_type (`nb_iot|cat1|rs485|lorawan`), valve_capable, valve_state, reporting_interval_s, last_uplink_at, last_reading_ml, last_reading_at, raw_last json, status.
- `meter_readings`: per §4.3/§6 — see architecture doc + raw fields above; unique `(meter, message_id, device_ts)`.
- `meter_commands`: per §5.
- `meter_sightings`: unclaimed device log (admin-only read).
- `meter_events`: health/security events (new source IP, expired commands).
- Billing spine (architecture §4, trimmed): `billing_units`, `tenant_accounts`, `occupancies`, `billing_settings` (+grace_days, warn_days, auto_valve_enabled), `tariffs`, `billing_cycles`, `invoices`, `invoice_lines`, `payment_transactions`, `payment_allocations`, `billing_job_runs`.

Landed as migrations 57–59 (numbering follows the repo, which had already passed 54 when this shipped).

## 7. Addon gating

Two layers, both enforced server-side: (a) the global `billing_module` feature flag (migration 54 kill-switch, gates the UI routes); (b) per-site `tenant_billing` capability = key ∈ `sites.addons` ∪ site's `packs.capabilities`, evaluated by `billing.HasCapability` on every custom route and background job. Entitlement fields (`addons`, `packs`, `price_override`) are admin-only writes (`guardEntitlement*` site hooks) — owners cannot self-grant. Frontend nav/routes follow the existing `featureGuard` pattern (convenience only, not security).

## 8. Testing + acceptance gates

1. Codec: all §3.4 fixtures round-trip; CRC16 variant locked by test; malformed frames rejected without panic (fuzz 10k random packets).
2. Simulated device (Go test UDP client): full session — uplink → time-calib received → queued close sent → ack → `valve_state=closed`. Replay same uplink → no duplicate reading.
3. Two devices interleaved sessions don't cross-talk.
4. Command TTL: queued command older than 48h unsent → `expired` + operator alert.
5. Arrears flow end-to-end (PocketBase test harness): overdue invoice → warning sent → close queued → simulated ack → state closed; payment → open queued.
6. `cd maji-server && go test ./... -count=1` and `make test` green.

## 9. Unknowns — status

- ~~CRC16 params~~ **RESOLVED:** AUG-CCITT / CRC-16-SPI-FUJITSU, big-endian bytes, full frame minus CRC (see §3.1).
- `/81/0` key 3 semantics + valve position-detect keys: uplink fixture shows key 3 = 1 (provisionally mapped 1=open, 0=closed in ingest); downlink key 0 uses 1=CLOSE / 0=OPEN per the command fixtures (counterintuitive — **verify against the first live unit** before trusting automation).
- Signal metric keys in `/99/0` (stored raw under `signal` json; label when known).
- Battery voltage key (manual says reported; not in example payload — watch live traffic).
- If fixtures are ambiguous, note it in the PR and proceed with raw-storage fallback rather than inventing semantics.

## 10. Delivery order

1. Codec + fixtures (pure, no server) → 2. Listener + session + ingest → 3. Command queue + valve → 4. Data model + dashboard wiring → 5. Arrears rules → 6. M-Pesa per architecture §8.

Hardware note (not agent's task): 3 sample meters are on order (NB-IoT; Cat.1 variant + RS485 protocol doc + valve cycle-life + measurement update rate requested from vendor). Live-device validation happens after items 1–3.
