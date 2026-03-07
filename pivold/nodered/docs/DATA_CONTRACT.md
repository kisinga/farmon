# Data contract: storage, handling and format

Single convention for how data is stored in PostgreSQL, how Node-RED flows pass context and params to DB nodes, and how the UI and backend exchange requests/responses.

### Registration (fPort 1)

- **Format:** Multi-frame only. Device sends 5 frames: `reg:header|...`, `reg:fields|...`, `reg:sys|...`, `reg:states|...`, `reg:cmds|...`.
- **Header fields:** `v`, `sv`, `type`, `fw`.
- **Legacy single-frame:** Not supported. Codec and flows reject non–multi-frame registration.

---

## 1. Device context

### Uplink path (ChirpStack → Node-RED)

- After **Extract Device Info**, every device message has `msg.deviceEui` (string).
- Use **only** `msg.deviceEui` for device identity in that path.
- Do not rely on `msg.params[0]` or flow context for uplink messages.

### UI path (Browser → Node-RED → DB)

- Device-scoped messages carry device identity in one of:
  - **Canonical**: `msg.context.eui` (when set by the node that handles `selectDevice`).
  - **Legacy**: `msg.params[0]` — for device-scoped queries, the first param is always `device_eui`.
- When handling `selectDevice` / `getHistory` / etc., prefer setting `msg.context = { eui, range? }` and keep `msg.params = [eui, ...]` for postgres nodes.
- Resolve eui in this order: `msg.payload?.eui` → `msg.context?.eui` → `flow.get('selectedDevice')`.

---

## 2. DB operations

### Convention

- Any message **into** a postgres node must have:
  - `msg.params` — array of values for `$1`, `$2`, ...
  - If the postgres node’s query is empty in the editor, the message must also have `msg.query`.
- Params order **must** match query placeholders.
- For device-scoped queries, **device_eui is always the first param** when present (e.g. `$1`).

### Composability

- **Build** nodes: set both `msg.query` and `msg.params`; pass the message to an Execute postgres node.
- **Execute** postgres node: uses `msg.query` (when node query is empty) and `msg.params`.
- Do not use ad-hoc param placement (e.g. sometimes `params = [eui]`, sometimes `[eui, id]` without a documented rule).

---

## 3. Request (UI → Node-RED)

- **Shape**: `{ topic, payload }`.
- **Device-scoped**: `payload.eui` is always set. Other keys are action-specific.

### Topic and payload shapes

| Topic           | Payload shape                                      |
|----------------|----------------------------------------------------|
| `getDevices`   | `{}` (none)                                       |
| `selectDevice` | `{ eui, range? }`                                 |
| `getHistory`   | `{ eui, field, range? }`                          |
| `setControl`   | `{ eui, control, state, duration? }`              |
| `clearOverride`| `{ eui, control }`                                |
| `getRules`     | `{ eui }`                                         |
| `saveRule`     | `{ eui, ...rule }`                                |
| `getEdgeRules` | `{ eui }`                                         |
| `sendCommand`  | `{ eui, fPort, command, value? }`                 |
| `otaStart`     | `{ eui, firmware }` (firmware = base64 .bin)       |
| `otaCancel`    | `{ eui }`                                          |
| `getFirmwareHistory` | `{ eui }`                                    |
| `getFirmwareErrorLog`| `{ eui? }` (omit eui for all devices)        |

---

## 4. Response (Node-RED → UI)

- **Shape**: `{ topic, payload }`.
- Optional: `payload.error` for errors.

### Standard payloads

- **List**: `payload` is an array (e.g. `devices` → array of `{ eui, name, type, lastSeen }`).
- **Device-scoped single resource**: `payload` includes `eui` plus resource (e.g. `deviceConfig`: `{ eui, fields, controls, schema, current, ... }`).
- **Time-series (history)**: `payload` is always `{ eui, field, data: [{ ts, value }, ...] }`. Used for all history responses whether the value came from `telemetry.data` or from columns `telemetry.rssi` / `telemetry.snr`.
- **OTA**: `topic: 'otaProgress'`, `payload`: `{ eui, status, chunkIndex?, totalChunks?, percent?, error? }` (status: `sending` | `done` | `failed` | `cancelled`). `topic: 'firmwareHistory'`, `payload`: array of `{ device_eui, started_at, finished_at, outcome, firmware_version?, total_chunks, chunks_received?, error_message? }`. `topic: 'firmwareErrorLog'`, `payload`: array of error entries (same shape, filtered for outcome in `failed`, `cancelled`).

---

## 5. Error object (mandatory standard)

All devices that report connectivity/error state **must** include the following keys in telemetry `data`. Keys are at most 2 characters. Counters reset daily (automatic 24h or on reset command). Payload may omit keys with value 0 to save space.

| Category          | Key  | Type   | Meaning |
|-------------------|------|--------|---------|
| **Total**         | `ec` | number | Sum of all sub-counters. |
| **Communication** | `na` | number | No ACK: confirmed uplink sent but no ACK received. |
|                   | `jf` | number | Join fail: OTAA join attempt failed. |
|                   | `sf` | number | Send fail: `sendData` failed (pre-check or radio). |
| **Hardware**      | `sr` | number | Sensor read failed. |
|                   | `dr` | number | Driver (relay/GPIO/UART) failed. |
|                   | `dp` | number | Display failed. |
| **OTA**           | `cs` | number | CRC/checksum mismatch. |
|                   | `wf` | number | Flash write failed (Update.write/end). |
|                   | `tm` | number | Timeout/incomplete or cancelled. |
| **System**        | `mm` | number | Memory/heap. |
|                   | `qf` | number | Queue full (TX or RX drop). |
|                   | `ts` | number | Task/scheduler. |
| **Logic**         | `rf` | number | Rule execution failed. |
|                   | `cv` | number | Config validation failed. |
|                   | `pf` | number | Persistence failed. |

- **Producer**: Firmware includes these in every telemetry payload (fPort 2) when supported. All counters reset daily.
- **Consumer**: UI displays the error breakdown (e.g. device info bar or diagnostics), optionally grouped by category. Backend stores `data` as JSONB; history can be queried per key.
- **Display**: Labels in UI must match this contract (see dashboard `errorFields.js` for canonical labels).

---

## 6. Telemetry row (storage)

- **Canonical row**: one row in `telemetry` = `(device_eui, data, rssi, snr)`.
  - `data`: JSONB — device payload; **must** include error object keys when device supports them: `{ bp, pd, tv, ec, na, jf, sf, sr, dr, dp, cs, wf, tm, mm, qf, ts, rf, cv, pf, tsr, ... }`. Keys with value 0 may be omitted.
  - `rssi`: number or null (from ChirpStack rxInfo).
  - `snr`: number or null (from ChirpStack rxInfo).
- **Single producer**: Only the **Extract Device Info** node produces the device message shape; only the **Telemetry Handler (fPort 2)** builds `msg.params` for the INSERT.
- **Normalized message** (after Extract): `msg.deviceEui`, `msg.fPort`, `msg.data` (object), `msg.rssi`, `msg.snr` (number or null). Coerce rssi/snr from rxInfo; invalid/missing deviceEui → drop message (return null).

---

## 7. History response shape

- **Unified**: All history responses use the same payload shape regardless of field source:
  - `{ eui, field, data: [{ ts, value }, ...] }`
- **Query**: One builder (Build History Query) maps `(eui, field, range)` to a single SQL pattern:
  - `rssi` → `SELECT ts, rssi::numeric AS value FROM telemetry WHERE ...`
  - `snr` → same with `snr`
  - Any other field → `SELECT ts, (data->>$3)::numeric AS value FROM telemetry WHERE ...` with `$3` = field key.
- Params: `[eui, interval]` for rssi/snr; `[eui, interval, field]` for data fields.

---

## 8. Device online vs gateway status

- **Source**: MQTT topic `+/gateway/+/state/conn` (gateway connection state; first segment = band, e.g. us915, eu868).
- **Payload**: `{ "gatewayId": "...", "state": "ONLINE" | "OFFLINE" }`.
- Node-RED subscribes to this topic, normalizes to `{ topic: 'gatewayStatus', payload: { gatewayId, state } }` and sends to the dashboard. When gateway is offline, the UI shows a critical banner (no data can flow); device status is unchanged — no side effects.
- The dashboard treats the selected device as **offline** if either the gateway is offline or the device’s `lastSeen` is within (telemetry_interval + margin); Device online = lastSeen (from telemetry) within 90s; gateway offline shown separately, boldly, no side effects on device status.

---

## 9. Troubleshooting: no history

If the device is online and sending data but **no history** appears (persistence vs fetch vs UI):

1. **Persistence** — Check that telemetry rows exist and that `rssi`/`snr` are stored when present in the uplink:
   ```sql
   SELECT device_eui, ts, rssi, snr, data
   FROM telemetry
   ORDER BY ts DESC
   LIMIT 20;
   ```
   - If there are no rows for your device: uplinks are not reaching the Telemetry Handler (e.g. Extract returns null, or fPort not 2).
   - If rows exist but `rssi`/`snr` are always NULL: ChirpStack `rxInfo` is missing or Extract is not setting `msg.rssi`/`msg.snr`.

2. **Device EUI format** — History is keyed by `device_eui`. Ensure the UI sends the same string as in the DB (no colons, same casing):
   ```sql
   SELECT DISTINCT device_eui FROM telemetry;
   ```
   Compare with the `eui` in the dashboard (e.g. from the device list / selected device). They must match exactly.

3. **Fetch** — In Node-RED, add a debug node after **Format History** and confirm you receive `topic: 'history'` with `payload.eui`, `payload.field`, and `payload.data` (array). If `data` is always `[]`, the history query returned 0 rows (see 1 and 2).

4. **UI** — In the browser console, after selecting a device you should see `[RequestHistory] fields: [...]` and then `[History] <field> : <n> points`. If you see 0 points for all fields, the backend is returning empty `data`; if you never see `[History]`, the history response is not reaching the client.
