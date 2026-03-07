---
name: Expanded error taxonomy
overview: Expand the device error object from communication-only to five categories (Communication, Hardware, OTA, System, Logic) with 2-char keys, daily reset for all, and a single reporting path so lib modules stay decoupled from app counters.
todos: []
isProject: false
---

# Expanded Error Taxonomy (Common Modules)

## 1. Error keys and categories (2-char keys, daily reset)


| Category          | Keys                                                                | Meaning                 |
| ----------------- | ------------------------------------------------------------------- | ----------------------- |
| **Total**         | `ec`                                                                | Sum of all sub-counters |
| **Communication** | `na` No ACK, `jf` Join fail, `sf` Send fail                         |                         |
| **Hardware**      | `sr` Sensor read fail, `dr` Driver fail, `dp` Display fail          |                         |
| **OTA**           | `cs` CRC/checksum, `wf` Write (flash) fail, `tm` Timeout/incomplete |                         |
| **System**        | `mm` Memory/heap, `qf` Queue full, `ts` Task/scheduler              |                         |
| **Logic**         | `rf` Rule fail, `cv` Config validation, `pf` Persistence fail       |                         |


Payload: send `ec` plus all 15 sub-keys. Omit keys that are 0 to save bytes (optional later). No category subtotals in payload; UI can group by category from a static key→category map.

## 2. Firmware: single source of truth and reporting path

**2.1 `heltec/lib/telemetry_keys.h`**  

- Add all keys under a clear comment block (Communication, Hardware, OTA, System, Logic).  
- Keep `ErrorCount` = `"ec"`; add e.g. `ErrorOtaCrc` = `"cs"`, `ErrorOtaWrite` = `"wf"`, `ErrorOtaTimeout` = `"tm"`, `ErrorSensorRead` = `"sr"`, `ErrorDriver` = `"dr"`, `ErrorDisplay` = `"dp"`, `ErrorMemory` = `"mm"`, `ErrorQueueFull` = `"qf"`, `ErrorTask` = `"ts"`, `ErrorRule` = `"rf"`, `ErrorConfig` = `"cv"`, `ErrorPersistence` = `"pf"`.

**2.2 `heltec/lib/error_reporter.h` (new, in lib)**  

- Define an **error reporting interface** used by radio_task, OTA, sensors, etc., so they stay in lib and do not depend on remote_app.  
- Options: (A) `IErrorReporter` with `void reportError(ErrorCategory cat, uint8_t subCode)` and app implements it; or (B) a queue of small `ErrorEvent { category, subcode }` messages that remote_app drains and maps to counters.  
- Prefer (A) with a global or task-injected callback to keep wiring simple and avoid extra message types.  
- Enum/constants for category (Comm, Hw, Ota, Sys, Logic) and sub-codes (e.g. Ota::Crc, Ota::Write, Ota::Timeout) so call sites are readable.

**2.3 `heltec/remote_app.cpp`**  

- Add counters for all 15 sub-keys; `ec` = sum computed when building telemetry.  
- Daily reset: reset all error counters (and existing tsr/reset logic) once per day; persist all counters with stable keys (e.g. `ec_na`, `ec_jf`, `ec_sf`, `ec_sr`, …).  
- Implement `IErrorReporter` (or equivalent): map `(category, subcode)` → increment correct counter, set persist flag.  
- Include error counts in telemetry payload only for keys > 0 (or always; document in DATA_CONTRACT).  
- **Communication**: Keep existing no-ack / join-fail / tx-fail events from radio_task; optionally split “queue full” from “send fail” so `_sendFailCount` → `sf`, “queue full” → `qf` (system).

**2.4 Instrumentation**  

- **radio_task**: Already reports no-ack, join-fail, tx-fail. Add reporting for “TX dropped (queue full)” → `qf` via IErrorReporter if used.  
- **ota_receiver**: Where we today LOGW + sendProgress(Failed): report `cs` (CRC mismatch), `wf` (Update.write/Update.end fail), `tm` (e.g. cancel/timeout) via IErrorReporter. OtaReceiver gets a `reportError(cat, sub)` callback (or IErrorReporter*) set by app.  
- **Sensors / drivers / display**: When read or setState fails, app (or a thin wrapper) calls reportError(Hw, sr/dr/dp). Can be added incrementally.  
- **System**: Queue full already occurs in remote_app and radio_task; route to `qf`. Memory/task failures when we have clear sites.

**2.5 Persistence keys**  

- Use stable names, e.g. `ec_na`, `ec_jf`, `ec_sf`, `ec_sr`, `ec_dr`, `ec_dp`, `ec_cs`, `ec_wf`, `ec_tm`, `ec_mm`, `ec_qf`, `ec_ts`, `ec_rf`, `ec_cv`, `ec_pf`. Load/save in one place in remote_app; daily reset clears all and saves.

## 3. Backend and UI

**3.1 `pi/nodered/docs/DATA_CONTRACT.md`**  

- §5 Error object: document the full table (ec + 5 categories × 3 sub-keys).  
- State that all counters reset daily; payload may omit keys with value 0 to save space (or require all keys; choose one and stick to it).

**3.2 `pi/nodered/uibuilder/dash/src/utils/errorFields.js`**  

- **Single source of truth**: `ERROR_OBJECT_KEYS` = all 16 keys in a defined order (e.g. ec, then na,jf,sf, sr,dr,dp, cs,wf,tm, mm,qf,ts, rf,cv,pf).  
- `ERROR_FIELD_LABELS` for each key.  
- Optional: `ERROR_CATEGORIES` = `{ Communication: ['na','jf','sf'], Hardware: ['sr','dr','dp'], … }` for grouping in UI.  
- `createErrorFields()`: generate field configs for all keys (same pattern as now).

**3.3 DeviceInfoBar / diagnostics**  

- Use `ERROR_OBJECT_KEYS` and `ERROR_FIELD_LABELS`; optionally group by `ERROR_CATEGORIES` so the bar or diagnostics section shows “Communication”, “Hardware”, “OTA”, etc. with sub-counts.

**3.4 fieldProcessors.js**  

- Already imports `ERROR_OBJECT_KEYS`; ensure the semantic-override and top-bar exclude lists include all new keys so they render as badges and stay out of duplicate top-bar slots.

## 4. Implementation order

1. **lib**: Add `telemetry_keys.h` entries and `error_reporter.h` (interface + enums).
2. **remote_app**: Add all counters, daily reset, persist keys, implement IErrorReporter; wire radio_task events (no-ack, join-fail, send-fail, and queue-full → qf).
3. **ota_receiver**: Accept IErrorReporter (or callback); on CRC fail report cs, on Update.write/end fail report wf, on cancel/timeout report tm.
4. **radio_task**: On “TX dropped (queue full)” report qf via IErrorReporter.
5. **DATA_CONTRACT + errorFields.js**: Full key set, labels, optional categories.
6. **UI**: DeviceInfoBar / diagnostics use new keys and optional grouping.
7. **Hardware/Logic**: Add sr, dr, dp, rf, cv, pf instrumentation incrementally where code paths exist.

## 5. Payload size

16 keys × ~6 bytes (e.g. `"na":5,`) ≈ 96 bytes for error block; with omitted-zero optimization, only non-zero keys sent. Fits within typical LoRa payload; telemetry formatter already uses short keys.