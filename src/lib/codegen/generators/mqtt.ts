import type { Manifest, BoardDef } from '@core';
import {
  MQTT_ROOT, commandTopic, automationsTopic, statusTopic, identityTopic, snapshotTopic, runsAckTopic, configTopic,
  HEAP_FREE_SENSOR, HEAP_MIN_SENSOR, HEAP_TOTAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR, WIFI_SIGNAL_SENSOR,
  collectTelemetryChannels, type TelemetryChannel,
  SYSTEM_STATE_TOKENS, STOP_REASON_TOKENS, FAULT_TOKENS, ORIGIN_TOKENS,
  COMMAND_TTL_S, ROUTE_START_RESULTS, ROUTE_STOP_RESULTS, NODE_SET_RESULTS,
  collectTunableNumbers, boardSupportedTransports, effectiveTransport,
} from '@core';
import type { GenerationMetadata } from "../backends/types";

/** esp-idf `esp_reset_reason()` enum (values 0..10) → wire token; index === enum value.
 *  Rides the snapshot's `text` so the dashboard can show why a controller last
 *  rebooted. A firmware crash (PANIC / *_WDT) is the panic signal — a recurring one is
 *  the bootloop tell; BROWNOUT is a separate power-supply fault, not a crash. */
const RESET_REASON_TOKENS = [
  'UNKNOWN', 'POWERON', 'EXT', 'SW', 'PANIC',
  'INT_WDT', 'TASK_WDT', 'WDT', 'DEEPSLEEP', 'BROWNOUT', 'SDIO',
] as const;

/** A C++ `static const char* NAME[] = {"a", "b"};` literal from a token list. */
const cppTokenArray = (name: string, toks: readonly string[]) =>
  `static const char* ${name}[] = {${toks.map(t => `"${t}"`).join(', ')}};`;

/** Indent each non-empty C++ line to a column (YAML block-scalar body). */
const indent = (lines: string[], n: number) =>
  lines.map(l => (l === '' ? '' : ' '.repeat(n) + l)).join('\n');

/**
 * Generate the MQTT runtime package: broker connection, explicit telemetry
 * publishing on our topic scheme, an operator command subscriber that dispatches
 * into the existing route/queue C++ functions, and an edge-triggered transition
 * log on the event topic.
 *
 * State rides as human-readable tokens (the same words the firmware shows on its
 * OLED): system_state / stop_reason publish their token via an index→token map
 * (the wire value is self-describing — the dashboard adds the friendly label).
 *
 * Broker host/port and the controller identity are baked from generation
 * metadata; the MQTT token is the only secret (verified server-side against
 * controllers.token_hash). The MQTT username is the controller id — the same
 * value used as the `{ctrl}` topic segment and as the device_id the broker
 * authenticates and confines by ACL.
 */
export function generateMqtt(m: Manifest, metadata: GenerationMetadata, board: BoardDef): string {
  const site = metadata.siteId;
  const ctrl = metadata.controllerId;
  // wifi_signal exists on-device only on the wifi transport (ethernet link is
  // binary; board-package.ts emits no wifi_dbm sensor there), so gate its publish
  // to avoid referencing an id that wasn't generated.
  const hasWifi = effectiveTransport(m.device.network, boardSupportedTransports(board)) === 'wifi';
  // ESPHome's auto-publish prefix, segregated from our scheme.
  // Single-sourced so topic_prefix and the raw log topic below can't desync.
  const topicPrefix = `${MQTT_ROOT}/${site}/${ctrl}/esphome`;
  const NS = SYSTEM_STATE_TOKENS.length;
  const NF = FAULT_TOKENS.length;
  const NR = STOP_REASON_TOKENS.length;

  // The shared channel enumeration (system-wide channels, then per-node) — the
  // same list the dashboard chart spec builds widgets from, so what the firmware
  // publishes and what the UI reads can never drift.
  const channels = collectTelemetryChannels(m);
  // The enumerated runtime tunables (level setpoints, route max-runtime, controller
  // safety timings, pressure calibration). These are no longer set by an operator
  // command — the server owns the desired config and delivers it RETAINED on the
  // config topic; the device applies each number from the message's kv (see the
  // config-apply lambda below). The allow-list is enumerated because ESPHome can't
  // id() a number by a runtime string. The applied value re-publishes in the snapshot.
  const tunables = collectTunableNumbers(m);
  // Per-tunable apply line: pull the desired value from the config kv (absent ⇒ leave
  // the number at its current/default — a partial config never zeroes an unlisted key)
  // and drive the entity. No restore_value on these numbers; the retained /config
  // message is the single source of truth and re-applies on every (re)connect.
  const configApplyLines = tunables.map((t) =>
    `if (cfg["${t.key}"].is<float>()) { id(${t.key}).make_call().set_value(cfg["${t.key}"].as<float>()).perform(); }`);

  // SNTP wall clock — the single `time: sntp` (id: sntp_time) on every device.
  // Drives the command-TTL gate and the runtime automation engine's time triggers
  // (both gate on time_trusted, set by on_time_sync). Always emitted now that the
  // baked schedule (which used to declare it) is gone.
  const timeBlock = '\ntime:\n  - platform: sntp\n    id: sntp_time\n    on_time_sync:\n      - then:\n          - lambda: \'id(time_trusted) = true;\'\n';

  // Device-facing TLS. ESPHome's mqtt: speaks plain TCP unless `certificate_authority`
  // is present, so emit the pinned cert only when the baked endpoint is TLS (8883).
  // The broker serves a SINGLE self-signed cert and the device pins THAT exact cert as
  // its trust anchor: esp-idf mbedTLS rejects a two-tier self-signed CA chain
  // (NOT_TRUSTED → -0x2700) but trusts a self-signed cert it finds byte-identical in
  // its store. skip_cert_cn_check: hostname matching is redundant under exact-cert
  // pinning (only this one cert is trusted) and dodges an mbedTLS CN-match edge case.
  // No client cert: the broker authenticates the device by username + mqtt_token.
  const tlsBlock = metadata.brokerTls
    ? `\n  certificate_authority: |-\n${indent(metadata.brokerCa.trimEnd().split('\n'), 4)}\n  skip_cert_cn_check: true`
    : '';

  // --- Operator command handler (JSON on the command topic) ------------------
  // Each handled command calls record_outcome (routes.h), which rides re-asserted
  // in the snapshot — the server reconciles the `commands` record and the dashboard
  // reads the reason. A manual command is tagged origin=MANUAL + the issuing user id
  // (`actor`) so the run is attributed on the snapshot. A stale command (older than
  // the TTL window) is refused outright.
  const cmdBody = [
    'const char* action = x["action"] | "";',
    'const char* command_id = x["command_id"] | "";',
    'const char* actor = x["actor"] | "";',
    '',
    '// TTL gate: once time is TRUSTED (a real SNTP sync, not the flash-seeded boot',
    '// estimate), drop a command older than the window (e.g. one queued while the link',
    '// was down) and report it as STALE. Untrusted clock → skip the gate (fail-open).',
    'auto _t = id(sntp_time).now();',
    'long long issued_at = x["issued_at"] | 0LL;',
    `if (id(time_trusted) && issued_at > 0 && (long long)_t.timestamp - issued_at > ${COMMAND_TTL_S}) {`,
    '  id(control).record_outcome(command_id, "REFUSED", "STALE");',
    '  return;',
    '}',
    '',
    'int route_id = x["route_id"] | -1;',
    'if (strcmp(action, "route_start") == 0) {',
    `  ${cppTokenArray('RS_TO', ROUTE_START_RESULTS.map(r => r.to))}`,
    `  ${cppTokenArray('RS_REASON', ROUTE_START_RESULTS.map(r => r.reason))}`,
    '  maji_ctl::StopSpec spec{};',
    '  spec.override_mask = (uint8_t) (x["override_mask"] | 0);',
    '  spec.ov_source_min_pct = (uint8_t) (x["ov_source_min_pct"] | 0);',
    '  spec.ov_dest_max_pct = (uint8_t) (x["ov_dest_max_pct"] | 0);',
    '  spec.ov_max_runtime_min = (uint16_t) (x["ov_max_runtime_min"] | 0);',
    '  spec.ov_target_duration_s = (uint16_t) (x["ov_target_duration_s"] | 0);',
    '  spec.ov_target_volume_l = (uint32_t) (x["ov_target_volume_l"] | 0);',
    '  int rc = id(control).start_route(route_id, command_id, spec, maji_ctl::ORIGIN_MANUAL, actor);',
    `  id(control).record_outcome(command_id, rc == 0 ? "APPLIED" : RS_TO[rc], rc == 0 ? "" : RS_REASON[rc]);`,
    '} else if (strcmp(action, "route_stop") == 0) {',
    `  ${cppTokenArray('RST_REASON', ROUTE_STOP_RESULTS.map(r => r.reason))}`,
    '  int rc = id(control).stop_route(route_id, command_id, maji_ctl::ORIGIN_MANUAL, actor);',
    `  id(control).record_outcome(command_id, rc == 0 ? "APPLIED" : "REFUSED", rc == 0 ? "" : RST_REASON[rc]);`,
    '} else if (strcmp(action, "fault_reset") == 0) {',
    '  id(control).fault_reset(route_id); id(system_state) = id(control).system_state();',
    '  id(control).record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "stop_all") == 0) {',
    '  id(btn_stop_all).press(); id(control).record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "reset_faults") == 0) {',
    '  id(btn_reset_faults).press(); id(control).record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "clear_queue") == 0) {',
    '  id(btn_clear_queue).press(); id(control).record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "node_set") == 0) {',
    '  // Manual claim/release via the dead-man registry the reconciler honours. A pump',
    '  // claim is GUARDED (manual_pump_precheck: source-low / dry-run-unprotectable) and',
    '  // reports a NODE_SET outcome; a valve claim just opens it; release always applies.',
    `  ${cppTokenArray('NS_TO', NODE_SET_RESULTS.map(r => r.to))}`,
    `  ${cppTokenArray('NS_REASON', NODE_SET_RESULTS.map(r => r.reason))}`,
    '  const char* node_id = x["node_id"] | "";',
    '  bool on = x["on"] | false;',
    '  if (node_id[0] == 0) {',
    '    // no node id — ignore',
    '  } else if (!on) {',
    '    int k = id(control).manual_slot(node_id);',
    '    id(claims).drop(node_id, "manual");',
    '    if (k >= 0) id(control).manual_clear_latch(k);',
    '    id(control).record_outcome(command_id, NS_TO[0], NS_REASON[0]);',
    '  } else {',
    '    int k = id(control).manual_slot(node_id);',
    '    if (k >= 0) {',
    '      int rc = id(control).manual_precheck(k);   // 0 ok, 1 source-low, 2 no local flow sensor',
    '      if (rc == 0) id(claims).extend(node_id, "manual");',
    '      id(control).record_outcome(command_id, NS_TO[rc], NS_REASON[rc]);',
    '    } else if (id(claims).is_valve_node(node_id)) {',
    '      id(claims).extend(node_id, "manual");',
    '      id(control).record_outcome(command_id, NS_TO[0], NS_REASON[0]);',
    '    } else {',
    '      id(control).record_outcome(command_id, NS_TO[3], NS_REASON[3]);  // no local actuator',
    '    }',
    '  }',
    '} else if (strcmp(action, "safety_override") == 0) {',
    '  if (x["on"] | false) id(safety_override).turn_on(); else id(safety_override).turn_off();',
    '  id(control).record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "firmware_update") == 0) {',
    '  // OTA pull: fetch + flash the image at `url`, verifying it against `md5` (which',
    '  // arrived over this cert-pinned, TTL-gated lane — the integrity anchor, so the',
    '  // download channel itself need not be trusted). Idempotent: if we already run the',
    '  // target version, ack without reflashing. The url/md5 hop through globals because',
    '  // ota.http_request.flash takes them at runtime via the do_ota_flash script.',
    '  const char* url = x["url"] | "";',
    '  const char* md5 = x["md5"] | "";',
    '  const char* version = x["version"] | "";',
    '  if (url[0] == 0 || md5[0] == 0) {',
    '    id(control).record_outcome(command_id, "REFUSED", "BAD_PARAMS");',
    '  } else if (strcmp(version, id(majiflow_generation_version).state.c_str()) == 0) {',
    '    id(control).record_outcome(command_id, "APPLIED", "ALREADY");',
    '  } else {',
    '    id(ota_url) = url;',
    '    id(ota_md5) = md5;',
    '    id(control).record_outcome(command_id, "APPLIED", "");  // ack before the flash reboots us',
    '    id(do_ota_flash).execute();',
    '  }',
    '} else {',
    '  ESP_LOGW("cmd", "unknown action: %s", action);',
    '  return;  // nothing handled — no outcome to fast-path',
    '}',
    '// Fast-path hint: publish a snapshot now so the dashboard sees this command outcome',
    '// + current state immediately, not on the next periodic interval. A dropped publish',
    '// self-heals on the next interval (the snapshot stays the single source of truth).',
    'id(publish_snapshot).execute();',
  ];

  // --- Desired-config handler (retained JSON on the config topic) ------------
  // The server owns the "desired controller config" (runtime tunables + calibration)
  // and republishes it RETAINED on a change; a (re)connecting device replays the
  // current one. Shape: { "version": "<opaque>", "config": { "<number_id>": <value> } }.
  // The device applies each enumerated number from the kv (an unlisted key is left
  // untouched — a partial config never zeroes a value), stores the opaque `version`
  // string verbatim (it NEVER hashes), and round-trips it back as the snapshot
  // `config_version` so the server can reconcile desired vs applied. The applied
  // numbers re-publish in the next snapshot's readings.
  const configBody = [
    '// `x` is the parsed object; `cfg` is the nested desired-config kv. Each apply line',
    '// only fires when the key is present and numeric (a partial config never zeroes a',
    '// value), so it is safe even if `config` is absent (every is<float>() is then false).',
    'auto cfg = x["config"];',
    ...configApplyLines,
    'const char* version = x["version"] | "";',
    'id(autos).set_config_version(version);',
    '// Fast-path hint: publish a snapshot now so the server confirms the applied',
    '// config_version immediately, not on the next periodic interval (self-heals if dropped).',
    'id(publish_snapshot).execute();',
  ];

  // MQTT here is the device↔server pipe: telemetry up, commands down. Cross-controller
  // coordination is device↔device over UDP (packages/coordination.{h,yaml}).

  // --- Controller snapshot (one JSON, re-asserted every interval) -----------
  // The single source of truth. ONE message carries: numeric readings (charts +
  // rollups), text channels, system state, per-route current run (with origin +
  // actor), and the recent command outcomes. The server projects it (latest doc,
  // batched raw history, transitions derived from changes, command reconcile).
  // Replaces the per-sensor telemetry, the route-state tokens, AND the lossy
  // transition-event log — nothing authoritative reads a one-shot message now.
  const SYS_SENSORS = new Set(['system_state', 'queue_depth', 'safety_override']);
  const readingCh = channels.filter(c => !SYS_SENSORS.has(c.sensor) && (c.kind === 'state' || c.kind === 'bool' || c.kind === 'cover'));
  const textCh = channels.filter(c => !SYS_SENSORS.has(c.sensor) && (c.kind === 'enum' || c.kind === 'text'));
  // +runs[]: the billing outbox (maji_meter::OUTBOX_CAP=16) the device re-asserts until
  // acked. A full outbox would otherwise crowd out the rest of the snapshot; a dropped run
  // self-heals (FIFO drain over snapshots), but headroom keeps steady state intact.
  // Tunables no longer echo into readings (the server owns the desired config), so they
  // are not sized here — only the one `config_version` text field rides the snapshot now.
  const BUFSZ = Math.max(2048, (readingCh.length + textCh.length) * 44 + m.routes.length * 192 + 1024 + 16 * 150);

  const readingLine = (c: TelemetryChannel): string => {
    if (c.kind === 'bool') return `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":%d", sep(), id(${c.ref}).state ? 1 : 0));`;
    if (c.kind === 'cover') return `if (!std::isnan(id(${c.ref}).position)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":%g", sep(), id(${c.ref}).position));`;
    return `if (!std::isnan(id(${c.ref}).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":%g", sep(), id(${c.ref}).state));`;
  };
  const textLine = (c: TelemetryChannel): string => {
    if (c.kind === 'enum') {
      const toks = c.tokens ?? [];
      return `{ ${cppTokenArray('TT', toks)} int v = id(${c.ref}); if (v >= 0 && v < ${toks.length}) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":\\"%s\\"", sep(), TT[v])); }`;
    }
    return `if (id(${c.ref}).state.length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":\\"%s\\"", sep(), maji_ctl::json_esc(id(${c.ref}).state.c_str())));`;
  };
  // origin/actor come from the per-route attribution (route_origin/route_actor),
  // which outlives the slot — so a finished run still reports who/what is
  // responsible for the route's current (idle) state until the next run rebinds it.
  // state/reason ride the live slot while one exists.
  const routeLine = (i: number): string =>
    `{ int s = maji_ctl::find_slot_by_route(cs, ${i}); int st = (s >= 0) ? cs.slots[s].state : 0; ` +
    `const char* o = (cs.route_origin[${i}] < 3) ? ORIGIN_TOK[cs.route_origin[${i}]] : "SYSTEM"; ` +
    `const char* ac = cs.route_actor[${i}].c_str(); const char* rs = ""; ` +
    `if (s >= 0) { ` +
    `if (st == 4) { int f = cs.slots[s].fault_code; if (f >= 0 && f < ${NF}) rs = FAULT_TOK[f]; } ` +
    `else if (st == 3 || st == 0) { int r = cs.slots[s].stop_reason; if (r >= 0 && r < ${NR}) rs = STOP_TOK[r]; } } ` +
    `put(snprintf(buf+n, sizeof(buf)-n, "%s{\\"id\\":${i},\\"state\\":\\"%s\\",\\"origin\\":\\"%s\\",\\"actor\\":\\"%s\\",\\"reason\\":\\"%s\\"", sep(), ` +
    `(st >= 0 && st < ${NS}) ? SYS_TOK[st] : "", o, ac, rs)); ` +
    // While RUNNING, append the live progress facts (the card-as-progress-bar reads them).
    `if (st == 2) { auto lv = id(control).route_live(s); put(snprintf(buf+n, sizeof(buf)-n, ` +
    `",\\"live\\":{\\"del\\":%d,\\"dur\\":%u,\\"tv\\":%u,\\"td\\":%u,\\"tl\\":%d}", ` +
    `(int) lv.delivered_l, (unsigned) lv.elapsed_s, (unsigned) lv.target_vol_l, (unsigned) lv.target_dur_s, (int) lv.target_lvl_pct)); } ` +
    `put(snprintf(buf+n, sizeof(buf)-n, "}")); }`;

  const snapshotBody = [
    'auto *mc = id(mqtt_client);',
    'if (!mc->is_connected()) return;',
    'auto &cs = id(control).state();  // slots / route attribution / outcomes',
    cppTokenArray('SYS_TOK', SYSTEM_STATE_TOKENS),
    cppTokenArray('STOP_TOK', STOP_REASON_TOKENS),
    cppTokenArray('FAULT_TOK', FAULT_TOKENS),
    cppTokenArray('ORIGIN_TOK', ORIGIN_TOKENS),
    cppTokenArray('RR_TOK', RESET_REASON_TOKENS),
    // static (not stack): ~${BUFSZ} B, and the snapshot script is mode:single on the one
    // main loop, so it is never reentrant — keep it off the loop-task stack (overflow safety).
    `static char buf[${BUFSZ}];`,
    'int n = 0;',
    'bool first = true;',
    'auto sep = [&]() -> const char* { const char* s = first ? "" : ","; first = false; return s; };',
    // Bounds-safe accumulate: snprintf returns the WOULD-BE length, so a naive
    // `n += snprintf(...)` can push n past the buffer and the next call then writes
    // out of bounds (sizeof-n underflows). put() clamps n to [0, sizeof(buf)-1], so
    // a truncated snapshot is simply dropped server-side (self-heals next interval).
    'auto put = [&](int w) { int rem = (int) sizeof(buf) - n; if (w < 0) w = 0; n += (w < rem) ? w : (rem > 0 ? rem - 1 : 0); };',
    'long long ts = id(time_trusted) ? (long long) id(sntp_time).now().timestamp : 0;',
    'put(snprintf(buf+n, sizeof(buf)-n, "{\\"ts\\":%lld,\\"readings\\":{", ts));',
    ...readingCh.map(readingLine),
    `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${HEAP_FREE_SENSOR}\\":%u", sep(), (unsigned) esp_get_free_heap_size()));`,
    `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${HEAP_MIN_SENSOR}\\":%u", sep(), (unsigned) esp_get_minimum_free_heap_size()));`,
    // Managed-heap pool size — the deterministic, partition-aware denominator for the
    // dashboard's RAM gauge. Constant for a build, but rides every snapshot so the
    // gauge needs no out-of-band board lookup. Paired cap with esp_get_free_heap_size.
    `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${HEAP_TOTAL_SENSOR}\\":%u", sep(), (unsigned) heap_caps_get_total_size(MALLOC_CAP_DEFAULT)));`,
    `if (!std::isnan(id(uptime_sec).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${UPTIME_SENSOR}\\":%g", sep(), id(uptime_sec).state));`,
    `if (!std::isnan(id(esp_temp).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${TEMP_SENSOR}\\":%g", sep(), id(esp_temp).state));`,
    ...(hasWifi ? [`if (!std::isnan(id(wifi_dbm).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${WIFI_SIGNAL_SENSOR}\\":%g", sep(), id(wifi_dbm).state));`] : []),
    'put(snprintf(buf+n, sizeof(buf)-n, "},\\"text\\":{"));',
    'first = true;',
    ...textCh.map(textLine),
    `{ int rr = (int) esp_reset_reason(); put(snprintf(buf+n, sizeof(buf)-n, "%s\\"reset_reason\\":\\"%s\\"", sep(), (rr >= 0 && rr < ${RESET_REASON_TOKENS.length}) ? RR_TOK[rr] : "UNKNOWN")); }`,
    'if (id(ip_addr).state.length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"ip\\":\\"%s\\"", sep(), maji_ctl::json_esc(id(ip_addr).state.c_str())));',
    '// Running firmware version (metadata sensor) — the server confirms an OTA release',
    '// once the device re-reports the version it was told to flash (see reconcileFirmware).',
    'if (id(majiflow_generation_version).state.length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"fw_version\\":\\"%s\\"", sep(), maji_ctl::json_esc(id(majiflow_generation_version).state.c_str())));',
    '// Applied desired-config version: the opaque string the server published on the',
    "// config topic, round-tripped verbatim (the device never hashes). The server",
    '// compares it against the version it currently publishes to reconcile desired vs',
    '// applied config. Empty until the first retained /config message is applied.',
    'if (id(autos).config_version().length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"config_version\\":\\"%s\\"", sep(), maji_ctl::json_esc(id(autos).config_version().c_str())));',
    `put(snprintf(buf+n, sizeof(buf)-n, "},\\"system\\":{\\"state\\":\\"%s\\",\\"queue\\":%d,\\"safety\\":%s},\\"routes\\":[", (id(system_state) >= 0 && id(system_state) < ${NS}) ? SYS_TOK[id(system_state)] : "", (int) id(queue_depth).state, id(safety_override).state ? "true" : "false"));`,
    'first = true;',
    ...m.routes.map((_r, i) => routeLine(i)),
    'put(snprintf(buf+n, sizeof(buf)-n, "],\\"outcomes\\":["));',
    'first = true;',
    'for (int k = 0; k < maji_ctl::MAX_OUTCOMES; k++) { if (!cs.outcomes[k].command_id.empty()) put(snprintf(buf+n, sizeof(buf)-n, "%s{\\"command_id\\":\\"%s\\",\\"result\\":\\"%s\\",\\"reason\\":\\"%s\\"}", sep(), cs.outcomes[k].command_id.c_str(), cs.outcomes[k].result.c_str(), cs.outcomes[k].reason.c_str())); }',
    // Billing runs: the meter's durable outbox of closed runs, re-asserted until the
    // retained runs_ack high-water-mark confirms them. meter_runs_json emits the array
    // body (comma-joined objects); put() clamps the would-be length so a full outbox
    // truncates safely and drains FIFO over subsequent snapshots.
    'put(snprintf(buf+n, sizeof(buf)-n, "],\\"runs\\":["));',
    'put(id(control).meter_runs_json(buf + n, (int) sizeof(buf) - n));',
    'put(snprintf(buf+n, sizeof(buf)-n, "]}"));',
    `mc->publish("${snapshotTopic(site, ctrl)}", buf);`,
  ];

  // --- On-connect retained facts ---------------------------------------------
  // Published once per (re)connect, retained:
  //  - identity: chip base MAC (duplicate-firmware tripwire; the server binds the
  //    controller to the first MAC it sees and flags a different board on the same id).
  //  - reset_reason: why the device last rebooted (esp_reset_reason → token). A crash
  // Only the retained identity (chip MAC) is published here now — reset_reason and
  // ip ride the snapshot's `text` (re-asserted every interval), so the server has
  // them from the latest snapshot doc without a separate retained publish.
  const onConnectBody = [
    `id(mqtt_client).publish("${identityTopic(site, ctrl)}", get_mac_address(), 0, true);`,
  ];

  return `# =============================================================================
# MajiFlow — MQTT Runtime
# =============================================================================
# AUTO-GENERATED. Replaces Home Assistant as the runtime transport.
#
# Reliability model: the device re-asserts ONE state snapshot every interval — the
# single source of truth. A dropped snapshot self-corrects on the next tick. No
# one-shot message is load-bearing; the server derives everything else (history,
# transition timeline, command outcomes) from the snapshot stream.
#
# - Snapshot: ONE JSON on majiflow/${site}/${ctrl}/state every interval — readings
#   (numbers), text channels, system state, per-route current run (state + origin +
#   actor), and the recent command outcomes. The server projects it into the latest
#   doc, batched numeric history (rollups), a derived transition timeline, and
#   command reconciliation.
# - Commands:  operator actions arrive as JSON on the command topic (QoS 1 over a
#   persistent session, so the broker queues across a reconnect; stale ones gated
#   by issued_at) and dispatch into the route/queue functions (routes.h / control);
#   each handled command records an outcome that rides the next snapshot.
# - Status:    retained birth/will on the status topic for online/offline; the
#   retained identity (chip MAC) is the duplicate-firmware tripwire.
#
# Mode: ${metadata.mode}. Broker: ${metadata.brokerAddress}:${metadata.brokerPort}.
# =============================================================================

mqtt:
  id: mqtt_client
  broker: "${metadata.brokerAddress}"
  port: ${metadata.brokerPort}${tlsBlock}
  username: "${ctrl}"
  password: !secret mqtt_token
  discovery: false
  # Persistent session (ESPHome's default, pinned here so it's load-bearing by
  # intent, not by an upstream default): with the QoS 1 command subscription below,
  # the broker keeps this device's session and queues commands across a reconnect
  # instead of dropping them — that, plus the issued_at TTL gate, is what kills the
  # "command lost until you retry" race.
  clean_session: false
  # Controller runs local control (routes, safety, UDP peer coordination)
  # autonomously and is an island when the server is down. An unreachable or
  # rejecting broker must never reboot it. 0s disables ESPHome's 15-min default.
  reboot_timeout: 0s
  # Publish from a dedicated MQTT task, not the main loop. ESPHome republishes
  # every entity's state on connect; run synchronously on the main loop that
  # burst can exceed the 5s task watchdog and reboot the controller (relays drop)
  # — a weak link only widens the window. Async = the loop enqueues and the mqtt
  # task sends; a stalled link drops messages instead of rebooting. esp-idf/esp32
  # only, which this firmware targets exclusively (no arduino/esp8266 backend).
  idf_send_async: true
  # We publish our own snapshot/status on absolute topics (in the lambdas below).
  # ESPHome still auto-publishes each entity's state under topic_prefix; we segregate
  # those under .../esphome/* so they never collide with our scheme (the server's
  # parsers key on the 4th segment: state / status / identity).
  # An empty prefix is no longer accepted by ESPHome (cv.publish_topic).
  topic_prefix: "${topicPrefix}"
  # Raw log stream gated to WARN+. At DEBUG every log line publishes to .../debug,
  # and a dropped publish logs an error that is itself published -> a feedback storm
  # that exhausts heap and reboots. WARN+ keeps real problems on the wire; routine
  # state rides the structured snapshot topic; UART keeps full detail.
  log_topic:
    topic: "${topicPrefix}/debug"
    level: WARN
  birth_message:
    topic: "${statusTopic(site, ctrl)}"
    payload: "1"
    retain: true
  will_message:
    topic: "${statusTopic(site, ctrl)}"
    payload: "0"
    retain: true
  on_connect:
    # Retained facts published once per (re)connect:
    #  - identity (chip base MAC): duplicate-firmware tripwire — the server binds the
    #    controller to the first MAC it sees and flags a later board reporting a different
    #    one (same baked identity flashed to two boards). get_mac_address() (not wifi_info)
    #    so it works on ethernet boards too.
    #  - reset_reason: why the device last rebooted (POWERON/SW = clean; PANIC/*_WDT =
    #    firmware crash; BROWNOUT = power-supply fault). Read from the string shadow on the
    #    dashboard to show the restart cause and who owns it.
    #  - ip: current device IP, for the dashboard's deep-link to the on-device web log console.
    - lambda: |-
${indent(onConnectBody, 8)}
  on_json_message:
    # QoS 1 over the (default) persistent session: the broker queues a command sent
    # during the device's reconnect window or a brief drop and delivers it on
    # reconnect, instead of losing it. The issued_at TTL gate (below) discards any
    # that went stale. The server already publishes commands at QoS 1.
    - topic: "${commandTopic(site, ctrl)}"
      qos: 1
      then:
        - lambda: |-
${indent(cmdBody, 12)}
    # Retained desired-config (JSON). The server owns it (runtime tunables +
    # calibration) and republishes it retained on a change; a (re)connecting device
    # replays the current one. The device applies each enumerated number from the
    # 'config' kv and stores the opaque 'version' to round-trip as config_version —
    # it never hashes. QoS 1 so the change isn't lost across a brief drop.
    - topic: "${configTopic(site, ctrl)}"
      qos: 1
      then:
        - lambda: |-
${indent(configBody, 12)}
  on_message:
    # Retained automation set (packed binary). Delivered on connect (retained
    # replay) and on every server-side change. The maji_automations component
    # validates magic + route_set_version and memcpy's it into the runtime table.
    - topic: "${automationsTopic(site, ctrl)}"
      qos: 1
      then:
        - lambda: |-
            id(autos).apply_set((const uint8_t *) x.data(), x.size());
    # Retained billing-run acknowledgement: "epoch:seq" high-water-mark. The device drops
    # every confirmed run from its durable outbox. Delivered on connect (retained replay)
    # and after each batch the server persists.
    - topic: "${runsAckTopic(site, ctrl)}"
      qos: 1
      then:
        - lambda: |-
            unsigned int e = 0, sq = 0;
            if (sscanf(x.c_str(), "%u:%u", &e, &sq) == 2) id(control).meter_on_ack(e, sq);
${timeBlock}
interval:
  # Snapshot: publish the whole controller state every update interval while
  # connected. Re-asserted (self-healing) — the single source of truth; the server
  # projects it. No separate per-sensor or transition-event publishing.
  - interval: \${update_interval}
    then:
      - script.execute: publish_snapshot

# --- OTA pull (firmware_update command) --------------------------------------
# The command handler stows the image url + md5 here, then runs do_ota_flash.
# ota.http_request.flash takes the url/md5 at runtime, so the lambda can't pass
# them inline — the global + script hop is ESPHome's idiom for a dynamic OTA.
globals:
  - id: ota_url
    type: std::string
  - id: ota_md5
    type: std::string

script:
  # Build + publish the full state snapshot. Run on the periodic interval AND
  # immediately after each handled command (fast-path hint). mode: single — the
  # interval and a command never run concurrently (one main loop) and a dropped
  # duplicate self-heals on the next interval.
  - id: publish_snapshot
    mode: single
    then:
      - lambda: |-
${indent(snapshotBody, 10)}
  - id: do_ota_flash
    then:
      - ota.http_request.flash:
          url: !lambda 'return id(ota_url);'
          md5: !lambda 'return id(ota_md5);'
`;
}
