# FarMon Phase B Roadmap: Protocol Evolution & Scalable Architecture

## 1. Where We Are (Phase A — In Progress)

Phase A delivers end-to-end device registration, dynamic UI composition, and reactive state management using the existing firmware protocol. The backend and frontend code is written and compiles; integration testing with live hardware is pending.

### 1.0 Phase A Remaining Work

**Blocking: Device has stale NVS registration state.** The device previously registered (before the backend had processing code), so NVS has `registered=1` and it skips fPort 1 registration frames on boot. To unblock:

1. Deploy updated backend + frontend (code is ready, `make dist` then `docker compose up -d`)
2. Send `forcereg` command from UI (Controls tab → Configuration → forcereg button) — sends fPort 14
3. Device clears NVS, re-registers on next join — watch logs for `registration: frame dev_eui=... frameKey="header"` through all 5 frames
4. After all 5 frames, backend logs `registration: complete` and sends ACK on fPort 5
5. DB populates: `device_fields` (10 fields), `device_controls` (2 controls), `devices.commands_json` (8 commands)
6. UI updates reactively via PocketBase realtime subscriptions — controls panel shows pump/valve with dynamic state buttons

**Phase A bugs fixed (this session):**

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `stateToIndex()` hardcoded "on"→1 | Valve "open" mapped to 0 (wrong) | DB lookup of `states_json`, fallback to legacy |
| `formatState()` hardcoded "off"/"on" | Valve state 1 showed "on" not "open" | `resolveStateName()` uses registered state names |
| `onClearOverride` hardcoded `'off'` | Valve reset to "off" not "closed" | Uses first registered state (index 0) |
| `sendCommand` fails without `commands_json` | Bootstrap deadlock: need forcereg to register, but forcereg needs commands_json | Well-known command→fPort fallbacks |
| Config panel empty pre-registration | `actionCommands` showed nothing | Well-known commands as fallback |
| No fPort 1 diagnostic logging | Couldn't tell if frames arrived | Added log on every fPort 1 frame |
| `commands` collection never written | Existed in schema but no code populated it | `insertCommand()` called from setControl, sendCommand, registration frames, and cmd ACKs |
| No registration status tracking | `devices.registration` JSON field never populated | `registered_at`, `schema_version` fields + structured registration summary |
| No command ACK handling | fPort 4 uplinks were ignored (fell to default) | New case 4 in uplink_handler logs ACK to commands collection |
| No command history in UI | No component existed | `CommandHistoryComponent` with realtime subscription on commands collection |
| No registration status in UI | Details card lacked registration info | Overview shows firmware version, registered_at, schema summary |

### 1.1 Current Protocol Summary

| Frame | fPort | Direction | Encoding | Typical Size | Purpose |
|-------|-------|-----------|----------|-------------|---------|
| Registration (5 frames) | 1 | Up | Text (pipe/csv) | 60-150B each | Device capability declaration |
| Telemetry | 2 | Up | Text (`key:value`) | 60-100B | Periodic sensor readings |
| State Change | 3 | Up | Binary (11B/event) | 11-220B | Control state transitions |
| Command ACK | 4 | Up | Text (`port:status`) | ~7B | Downlink acknowledgment |
| Reg ACK | 5 | Down | 1B | 1B | Registration confirmation |
| Diagnostics | 6 | Up | Text (csv) | 140-160B | Device status dump |
| Reconnection | 7 | Up | Binary | 4B | Disconnect duration |
| OTA Progress | 8 | Up | Binary | 3B | Firmware update status |
| Commands | 10-16 | Down | Binary | 0-4B | Device commands (reset, interval, reboot...) |
| Direct Control | 20 | Down | Binary (7B) | 7B | Set control state |
| Rule Update | 30 | Down | Binary (12B/rule) | 12B | Edge rule management |
| OTA Start/Chunk/Cancel | 40-42 | Down | Binary | 6-222B | Firmware updates |

### 1.2 Current Architecture State

**Backend (Go + PocketBase)** — code complete, compiles clean
- `registration.go`: Multi-frame assembler (5 frames, 60s expiry, mutex-protected) + parsers + DB persistence
- `uplink_handler.go`: fPort dispatch — fPort 1→registration assembler (with per-frame logging), fPort 2→telemetry, fPort 3→state changes (dynamic state name resolution via `resolveStateName()`), fPort 4→command ACK logging, fPort 8→OTA
- `api_handlers.go`: `setControl` uses dynamic `stateToIndex()` (DB lookup) + logs to commands collection; `sendCommand` with well-known fallbacks for bootstrap + logs to commands collection
- `store.go`: `insertCommand()` writes to `commands` collection for persistent audit trail
- `codec.go`: Decodes all uplink fPorts (1=registration text, 2=telemetry text, 3=state change binary, 4=cmd ACK, 6=diagnostics, 8=OTA progress)
- Migration `1736381000_registration_fields.js`: Adds `state_class`, `access`, `field_idx` to `device_fields`; `display_name`, `states_json`, `control_idx` to `device_controls`; `commands_json`, `registered_at`, `schema_version` to `devices`
- Pipeline: ZMQ SUB to concentratord → LoRaWAN decrypt → codec decode → fPort dispatch → store

**Frontend (Angular 19)** — code complete, builds clean
- `DeviceContextService`: Signal-based state hub with PocketBase realtime subscriptions for controls, fields, and telemetry
- `ControlsPanelComponent` → `ControlRowComponent`: Dynamic state buttons from `states_json`, display names from registration
- `DeviceConfigPanelComponent`: Writable fields (access=w) with value input + action commands (with well-known fallbacks pre-registration)
- `CommandHistoryComponent`: Realtime command log with status badges (sent/acked/error), sourced from `commands` collection
- `DeviceDetailComponent`: Dynamic charts, overview with registration status (firmware, registered_at, schema summary), telemetry/system split, command history on Controls tab
- `requestKey` on all SDK calls to prevent auto-cancellation

**Firmware (Heltec ESP32)** — unchanged, proven working
- Schema defined in C++ structs: `FieldDescriptor`, `ControlDescriptor`, `Schema`
- Registration sends 5 text frames via `RegistrationManager` (with NVS persistence — skips if already registered)
- Telemetry encoded as comma-separated `key:value` text
- State changes already binary (11B per event, efficient)
- Commands dispatched by fPort via `CommandTranslator`
- Edge rules evaluated locally, binary sync via fPort 30
- OTA via chunked binary protocol (fPorts 40-42)

### 1.3 What Works Well (Keep)

- **State change binary format** (fPort 3): Already optimal at 11B/event with batching
- **Edge rules binary format** (fPort 30): 12B/rule, schema-indexed, efficient
- **OTA protocol** (fPorts 40-42): Mature chunked binary with CRC validation
- **PocketBase realtime subscriptions**: Reactive, per-device filtered, ref-counted
- **Signal-based UI composition**: Clean reactive data flow with computed derivations
- **Registration assembler pattern**: Multi-frame accumulation with expiry

---

## 2. Where We Want To Be (Phase B Target State)

### 2.1 Design Goals

1. **Reduce registration airtime by 80%** — hash-first negotiation eliminates redundant schema sends on re-join
2. **Reduce telemetry payload by 50-60%** — binary values-only encoding eliminates key overhead
3. **Unify command routing** — single fPort with command ID, not per-command fPorts
4. **Support richer control types** — toggles, ranges (sliders), enums beyond on/off
5. **Group fields for UI organization** — telemetry/system/computed categories rendered in cards
6. **Schema versioning** — server caches schemas, devices only re-send on change

### 2.2 Target Protocol

#### Registration: Hash-First Negotiation

**New flow** (replaces 5 text frames):

```
Device → Server: fPort 1, [schema_hash (8B)]              // 8 bytes
Server → Device: fPort 5, [0x01] (known) OR [0x00] (send) // 1 byte

If unknown:
  Device → Server: fPort 1, [0xFF, binary_schema...]       // Full schema, binary
  Server → Device: fPort 5, [0x01]                         // ACK
```

**Savings**: Re-joining device sends 8B instead of ~500B (5 frames). Only new/changed schemas require full send.

#### Binary Schema Format

```
Schema Header (4B):
  [version: u16 LE] [field_count: u8] [control_count: u8]

Per Field (variable, ~12-20B):
  [index: u8] [key_len: u8] [key: ...] [name_len: u8] [name: ...]
  [unit_len: u8] [unit: ...] [type: u8] [category: u8]
  [flags: u8 (readable|writable)] [state_class: u8]
  [min: f32 LE] [max: f32 LE]
  [group_len: u8] [group: ...]

Per Control (variable, ~10-20B):
  [index: u8] [key_len: u8] [key: ...] [name_len: u8] [name: ...]
  [control_type: u8 (toggle=0, range=1, enum=2)]
  [state_count: u8] [states: len-prefixed strings...]
  // For range type: [min: f32 LE] [max: f32 LE] [step: f32 LE]

Commands (variable):
  [cmd_count: u8]
  Per command: [name_len: u8] [name: ...] [cmd_id: u8]
```

**Total**: ~150-200B for current water_monitor schema (vs ~500B text). Single frame at DR3.

#### Telemetry: Binary Values-Only

**Current** (text, ~80B):
```
pd:5,tv:123.4,bp:87.2,ec:0,tsr:3600,tx:30,ul:42,dl:3,up:7200,bc:2
```

**Target** (binary, ~30B):
```
[presence_mask: u16 LE] [values in schema index order...]
```

Each value encoded by its `FieldType`:
- `FLOAT`: 4B IEEE754 LE
- `UINT32`: 4B LE
- `INT32`: 4B LE (signed)
- `ENUM`: 1B (index)

Presence mask: bit N=1 means field N is included. Server reconstructs keys from cached schema.

**Example** (10 fields, all present):
```
[0xFF, 0x03]  // bits 0-9 set = 10 fields present
[u32: pd] [f32: tv] [f32: bp] [u32: ec] [u32: tsr]
[u32: tx] [u32: ul] [u32: dl] [u32: up] [u32: bc]
= 2 + 40 = 42 bytes (vs ~80B text = 47% reduction)
```

With sparse data (only 4 of 10 changed):
```
[0x0F, 0x00]  // bits 0-3 set = 4 fields
[u32: pd] [f32: tv] [f32: bp] [u32: ec]
= 2 + 16 = 18 bytes (vs ~80B = 78% reduction)
```

#### Commands: Unified fPort

**Current**: fPort 10=reset, 11=interval, 12=reboot, 13=clearerr, 14=forcereg, 15=status, 16=display_timeout, 20=control

**Target**: Single `FPORT_COMMAND = 50` with structure:
```
[cmd_id: u8] [payload: variable]
```

Command IDs from registration's command map (replaces fPort mapping). Control commands include control_idx and state in payload.

**Benefits**:
- fPort range no longer a bottleneck (1-223 limit)
- Adding commands doesn't require new fPort constants
- Command routing is data-driven from registration

#### Control Types: Beyond Toggle

**Current**: Discrete named states only (`off;on`, `closed;open`)

**Target control_type enum**:

| Type | UI Widget | Downlink Payload | Example |
|------|-----------|-----------------|---------|
| `toggle` (0) | State buttons | `[ctrl_idx, state_idx]` | Pump: off/on |
| `range` (1) | Slider + input | `[ctrl_idx, f32_value LE]` | Dimmer: 0-100% |
| `enum` (2) | Dropdown | `[ctrl_idx, enum_idx]` | Mode: auto/manual/eco |

Frontend renders appropriate widget per `control_type`. Backend validates value against min/max (range) or state count (enum/toggle).

#### Field Grouping

Add optional `group` string to `FieldDescriptor`:
```cpp
char group[16];  // e.g., "water", "power", "network", ""
```

Fields with the same group render together in a card. Empty group = ungrouped (shown in default card).

**UI**: Overview tab renders one card per group instead of flat telemetry/system split.

---

## 3. Gap Analysis: Current → Target

### 3.1 Firmware Changes

| # | Component | Current | Target | Effort | Files |
|---|-----------|---------|--------|--------|-------|
| F1 | Schema hash | None | SHA-256 of binary schema → 8B truncated hash | Medium | `message_schema.h`, `registration_manager.cpp` |
| F2 | Binary schema serializer | Text `formatForRegistration()` | Binary encoder matching § 2.2 format | Medium | `message_schema.h` |
| F3 | Hash-first registration | Always sends 5 text frames | Send hash first; full schema only on NACK | Medium | `registration_manager.cpp`, `remote_app.cpp` |
| F4 | Binary telemetry | Text `key:value` builder | Presence mask + packed values by type | Medium | `remote_app.cpp` |
| F5 | Unified command fPort | Per-fPort dispatch in `CommandTranslator` | Single fPort 50, `cmd_id` dispatch | Low | `command_translator.h`, `protocol_constants.h` |
| F6 | Control types | Toggle only (2 states) | Add `control_type`, range min/max/step | Low | `message_schema.h`, `edge_rules.h` |
| F7 | Field grouping | No groups | Add `group` to `FieldDescriptor` | Low | `message_schema.h`, device configs |
| F8 | Backward compat | N/A | Schema version field gates binary vs text | Low | `registration_manager.cpp` |

### 3.2 Backend Changes

| # | Component | Current | Target | Effort | Files |
|---|-----------|---------|--------|--------|-------|
| B1 | Binary schema parser | Text parsers in `registration.go` | Binary decoder matching firmware encoder | Medium | `registration.go` |
| B2 | Schema hash cache | None | `device_schemas` collection stores hash→schema | Low | `registration.go`, `store.go` |
| B3 | Hash-first protocol | ACK on fPort 5 after all frames | Known/unknown response based on hash lookup | Low | `uplink_handler.go` |
| B4 | Binary telemetry decoder | Text `key:value` parser in `codec.go` | Presence mask + type-aware value extraction | Medium | `internal/codec/codec.go` |
| B5 | Schema-based reconstruction | Codec returns keys from payload | Codec uses cached schema to map indices→keys | Low | `internal/codec/codec.go`, `store.go` |
| B6 | Unified command builder | Per-fPort payload builders | Single fPort 50, cmd_id from commands_json | Low | `api_handlers.go`, `pipeline.go` |
| B7 | Control type storage | `states_json` only | Add `control_type`, `range_min/max/step` to `device_controls` | Low | migration, `registration.go` |
| B8 | Field group storage | `category` only | Add `group` to `device_fields` | Low | migration, `registration.go` |
| B9 | Protocol version gate | None | Check schema_version: v1=text, v2=binary | Low | `internal/codec/codec.go` |

### 3.3 Frontend Changes

| # | Component | Current | Target | Effort | Files |
|---|-----------|---------|--------|--------|-------|
| U1 | Range control widget | Toggle buttons only | Slider + number input for `control_type=range` | Medium | `control-row.component.ts` |
| U2 | Enum control widget | Toggle buttons only | Dropdown for `control_type=enum` | Low | `control-row.component.ts` |
| U3 | Field grouping | Split by category | Group by `group` field, render card per group | Low | `device-detail.component.html/.ts` |
| U4 | Schema status indicator | None | Show schema version + last registration time | Low | `device-detail.component.html` |
| U5 | Control type in context | Not tracked | Add `control_type` to `DeviceControl` interface | Low | `api.service.ts`, `device-context.service.ts` |

---

## 4. Implementation Plan

### 4.0 Pre-Work: Backward Compatibility Gate

Before any protocol changes, establish the version gate so old and new devices coexist:

**Firmware**: Schema version 1 = current text protocol. Schema version 2 = binary protocol.
**Backend codec**: Check `schema_version` from device record → dispatch to text or binary decoder.
**Registration**: v1 devices continue sending 5 text frames. v2 devices use hash-first binary.

This means Phase B changes are **incremental and non-breaking**. A fleet can have mixed v1/v2 devices.

### 4.1 Stage 1: Binary Telemetry (Highest Impact, Lowest Risk)

**Why first**: Telemetry is the highest-frequency message. Binary encoding cuts airtime by 50%+, extending battery life and reducing duty cycle pressure. No registration protocol change needed — server uses existing field schema to decode.

**Firmware**:
- Add `encodeTelemetryBinary()` alongside existing text encoder
- Use schema field order for value packing, presence mask for sparse updates
- Gate on schema_version >= 2

**Backend**:
- Add `decodeBinaryTelemetry(fPort, payload, schema)` to codec
- Load device's field schema from cache/DB to reconstruct keys
- Falls back to text decoder for schema_version 1 devices

**Verification**: Device sends binary telemetry → backend decodes → same JSON in `telemetry.data` → charts render identically.

### 4.2 Stage 2: Schema Hash Negotiation

**Why second**: Reduces registration from 5 frames (~5s airtime) to 1 frame (8B, <0.1s) on re-join. Critical for battery-powered devices that rejoin frequently.

**Firmware**:
- Compute SHA-256 of binary schema, truncate to 8B
- On join: send hash on fPort 1
- Wait for fPort 5 response: `0x01` = known (done), `0x00` = unknown (send full)
- If unknown: send full binary schema on fPort 1 (single frame, ~150-200B)

**Backend**:
- On fPort 1 with 8B payload: look up hash in `device_schemas`
- If found: send `0x01` ACK, apply cached schema
- If not found: send `0x00` NACK, wait for full schema
- On fPort 1 with `0xFF` prefix: parse binary schema, store hash→schema, send `0x01` ACK

**Migration**: Add `schema_hash` (text, indexed) to `device_schemas` collection.

**Verification**: Device re-joins → sends hash → server ACKs → no full registration → device operates normally.

### 4.3 Stage 3: Unified Command fPort

**Why third**: Simplifies both firmware and backend command infrastructure. Prerequisite for richer control types.

**Firmware**:
- Add `FPORT_COMMAND = 50` constant
- `CommandTranslator::dispatch()` reads `cmd_id` from byte 0, routes to handler
- Keep old fPorts working for backward compat (respond to both)
- Registration `cmds` frame maps names to cmd_ids instead of fPorts

**Backend**:
- `sendCommandHandler` uses cmd_id instead of fPort lookup
- `EnqueueDownlink` sends on fPort 50 with `[cmd_id, ...payload]`
- `setControlHandler` builds control payload with cmd_id prefix

**Verification**: UI sends command → backend builds fPort 50 payload → device receives and executes → ACK on fPort 4.

### 4.4 Stage 4: Rich Control Types

**Why fourth**: Depends on unified command fPort for clean payload routing.

**Firmware**:
- Add `control_type` enum to `ControlDescriptor`: `TOGGLE=0, RANGE=1, ENUM=2`
- Range controls: add `min_val`, `max_val`, `step` to descriptor
- State change report (fPort 3): extend to include float value for range controls
- Include control_type in binary schema

**Backend**:
- Migration: add `control_type`, `range_min`, `range_max`, `range_step` to `device_controls`
- `upsertDeviceControlFromReg`: store control_type and range params
- State change handler: store float value for range controls
- `setControlHandler`: validate value against type constraints

**Frontend**:
- `ControlRowComponent`: switch on control_type
  - `toggle`: current state buttons (existing)
  - `range`: slider + number input with min/max/step
  - `enum`: dropdown with state names
- `DeviceControl` interface: add `control_type`, `range_min`, `range_max`, `range_step`
- `DeviceContextService`: pass through new fields

**Verification**: Device registers with range control → UI shows slider → user sets value → downlink → device applies → state change confirms.

### 4.5 Stage 5: Field Grouping

**Why last**: Pure UI improvement, no protocol urgency. Can be done alongside any stage.

**Firmware**:
- Add `group[16]` to `FieldDescriptor`
- Include in binary schema encoding

**Backend**:
- Migration: add `group` (text) to `device_fields`
- `upsertDeviceField`: store group

**Frontend**:
- `DeviceDetailComponent`: computed `fieldGroups` that groups by `group` field
- Overview tab: render one card per group with group name as title
- Fields with empty group go into "Other" card

**Verification**: Device registers with grouped fields → overview shows cards per group → adding new group on device → UI reflects after re-registration.

---

## 5. Migration Strategy

### 5.1 Protocol Coexistence

The `schema_version` field (sent in registration header, stored in `device_schemas`) gates all behavior:

| Version | Registration | Telemetry | Commands | Controls |
|---------|-------------|-----------|----------|----------|
| 1 (current) | 5 text frames | Text `key:value` | Per-fPort (10-16, 20) | Toggle only |
| 2 (target) | Hash-first binary | Binary presence+values | Unified fPort 50 | Toggle, range, enum |

Backend maintains both code paths. A device running v1 firmware works alongside v2 devices indefinitely.

### 5.2 Database Migrations

Each stage adds columns; no destructive changes:

| Stage | Migration | Collections Affected |
|-------|-----------|---------------------|
| 1 | None (existing schema sufficient) | — |
| 2 | Add `schema_hash` to `device_schemas` | device_schemas |
| 3 | None (commands_json already flexible) | — |
| 4 | Add `control_type`, `range_min/max/step` to `device_controls` | device_controls |
| 5 | Add `group` to `device_fields` | device_fields |

### 5.3 Firmware Update Path

Devices update firmware via OTA (fPorts 40-42). The update sequence:
1. Deploy backend with v2 support (backward-compatible, handles both)
2. Build v2 firmware
3. OTA push to devices one at a time
4. Each device re-registers with v2 schema on next join
5. Server caches new schema, subsequent joins use hash-first

No coordinated cutover required. Mixed fleets work indefinitely.

---

## 6. Airtime & Battery Impact Analysis

### 6.1 Registration

| Scenario | v1 (Current) | v2 (Target) | Savings |
|----------|-------------|-------------|---------|
| First join (new device) | 5 frames, ~500B, ~5s | 1 hash (8B) + 1 schema (~180B), ~2s | 60% |
| Re-join (known schema) | 5 frames, ~500B, ~5s | 1 hash (8B), ~0.1s | 98% |
| Schema changed | 5 frames, ~500B, ~5s | 1 hash + 1 schema, ~2s | 60% |

### 6.2 Telemetry (per message)

| Scenario | v1 (Current) | v2 (Target) | Savings |
|----------|-------------|-------------|---------|
| All 10 fields | ~80B text | ~42B binary | 47% |
| 4 of 10 fields (sparse) | ~80B text (sends all) | ~18B binary | 78% |
| 2 fields only | ~80B text | ~10B binary | 88% |

### 6.3 Daily Duty Cycle (60s interval, EU868)

| Component | v1 | v2 | Reduction |
|-----------|----|----|-----------|
| Telemetry (1440 msgs/day) | ~115,200B | ~60,480B | 47% |
| Registration (1 join/day) | ~500B | ~8B | 98% |
| State changes | Same | Same | 0% |
| **Total daily airtime** | ~1,200s | ~650s | **46%** |

---

## 7. Testing Strategy

### 7.1 Unit Tests

| Component | Test |
|-----------|------|
| Binary schema serializer (FW) | Round-trip: serialize → deserialize → compare |
| Schema hash (FW) | Deterministic: same schema → same hash |
| Binary telemetry encoder (FW) | Encode → decode → compare values |
| Binary schema parser (Backend) | Parse known binary → verify fields match |
| Binary telemetry decoder (Backend) | Decode known binary → verify JSON matches |
| Hash lookup (Backend) | Known hash returns schema; unknown returns nil |
| Control type validation (Backend) | Range: reject out-of-bounds; enum: reject invalid index |

### 7.2 Integration Tests

| Scenario | Verification |
|----------|-------------|
| v1 device joins v2 backend | Text protocol works, no regression |
| v2 device joins, first time | Full binary schema sent, stored, ACKed |
| v2 device re-joins | Hash only, server ACKs from cache |
| v2 device schema changes | Hash miss, full schema sent, cache updated |
| Mixed fleet (v1 + v2) | Both work simultaneously, correct decoders used |
| Binary telemetry | Charts render same data as text protocol |
| Range control | Slider sets value, device reports state change |
| OTA v1→v2 | Device updates, re-registers with v2, hash cached |

### 7.3 Load/Stress Tests

| Metric | Target |
|--------|--------|
| Schema cache lookup | < 1ms (PocketBase indexed query) |
| Binary telemetry decode | < 0.1ms per message |
| Concurrent v1+v2 devices | 50+ without contention |
| Schema cache size | < 1MB for 100 unique schemas |

---

## 8. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Binary encoding bugs cause data loss | High | Extensive unit tests + keep text fallback for v1 |
| Hash collision (two schemas, same hash) | Low (8B = 2^64) | Verify full schema on hash match for first N devices |
| OTA failure leaves device on v1 | Medium | v1 remains fully supported indefinitely |
| Schema cache grows unbounded | Low | TTL on device_schemas, prune on device delete |
| Partial binary frame (DR0 truncation) | Medium | Check payload length before parsing, reject short frames |
| Range control float precision | Low | Use IEEE754 f32 on both sides, test edge cases |

---

## 9. Success Criteria

Phase B is complete when:

1. A new device joins, sends 8B hash, gets ACKed, and operates without full registration
2. Telemetry payloads are binary, charts show identical data to text protocol
3. All commands route through fPort 50 with cmd_id
4. A range control (e.g., dimmer) renders as a slider in the UI and sets a float value on the device
5. Fields with groups render in organized cards in the overview tab
6. A v1 device operates alongside v2 devices with no issues
7. Daily airtime is reduced by at least 40%
8. No "request aborted" errors on rapid navigation (Phase A fix holds)

---

## 10. Estimated Stage Sequencing

```
Stage 1: Binary Telemetry ──────── FW + Backend codec
    ↓
Stage 2: Schema Hash ───────────── FW + Backend registration
    ↓
Stage 3: Unified Command fPort ── FW + Backend handlers
    ↓
Stage 4: Rich Control Types ───── FW + Backend + Frontend
    ↓
Stage 5: Field Grouping ────────── FW + Backend + Frontend (can parallel with 3-4)
```

Stages 1-2 are the highest-value changes (airtime/battery).
Stages 3-4 are the highest-complexity changes (multi-layer protocol).
Stage 5 is independent and can be done anytime.

Each stage is independently deployable and backward-compatible. No big-bang cutover required.
