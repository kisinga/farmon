import type { Manifest, BoardDef } from '@core';
import {
  MQTT_ROOT, commandTopic, automationsTopic, statusTopic, identityTopic, snapshotTopic,
  HEAP_FREE_SENSOR, HEAP_MIN_SENSOR, UPTIME_SENSOR, TEMP_SENSOR, WIFI_SIGNAL_SENSOR,
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
  // config_set: write any runtime-tunable number entity (level setpoints, route
  // max-runtime, controller safety timings, pressure calibration) by id.
  // set_value().perform() fires the number's restore so the change persists across
  // reboot; out-of-range values clamp to the topology-baked default in the getter.
  // The new value re-publishes on the next telemetry tick (see the publisher below).
  // The allow-list is the enumerated tunables — ESPHome can't id() by runtime string.
  const tunables = collectTunableNumbers(m);
  const configCases = tunables.length === 0 ? [] : [
    '} else if (strcmp(action, "config_set") == 0) {',
    '  const char* key = x["key"] | "";',
    '  float value = x["value"] | 0.0f;',
    ...tunables.map((t, i) => {
      const lead = i === 0 ? 'if' : 'else if';
      return `  ${lead} (strcmp(key, "${t.key}") == 0) { id(${t.key}).make_call().set_value(value).perform(); }`;
    }),
    '  record_outcome(command_id, "APPLIED", "");',
  ];

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
    '  record_outcome(command_id, "REFUSED", "STALE");',
    '  return;',
    '}',
    '',
    'int route_id = x["route_id"] | -1;',
    'if (strcmp(action, "route_start") == 0) {',
    `  ${cppTokenArray('RS_TO', ROUTE_START_RESULTS.map(r => r.to))}`,
    `  ${cppTokenArray('RS_REASON', ROUTE_START_RESULTS.map(r => r.reason))}`,
    '  int rc = try_route_start(route_id, command_id, STOPSPEC_INHERIT, ORIGIN_MANUAL, actor);',
    `  record_outcome(command_id, rc == 0 ? "APPLIED" : RS_TO[rc], rc == 0 ? "" : RS_REASON[rc]);`,
    '} else if (strcmp(action, "route_stop") == 0) {',
    `  ${cppTokenArray('RST_REASON', ROUTE_STOP_RESULTS.map(r => r.reason))}`,
    '  int rc = try_route_stop(route_id, command_id);',
    `  record_outcome(command_id, rc == 0 ? "APPLIED" : "REFUSED", rc == 0 ? "" : RST_REASON[rc]);`,
    '} else if (strcmp(action, "fault_reset") == 0) {',
    '  int s = find_slot_by_route(route_id);',
    '  if (s >= 0 && slots[s].state == 4) { init_slot(s); id(system_state) = derived_system_state(); }',
    '  record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "stop_all") == 0) {',
    '  id(btn_stop_all).press(); record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "reset_faults") == 0) {',
    '  id(btn_reset_faults).press(); record_outcome(command_id, "APPLIED", "");',
    '} else if (strcmp(action, "clear_queue") == 0) {',
    '  id(btn_clear_queue).press(); record_outcome(command_id, "APPLIED", "");',
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
    '    int k = manual_pump_slot(node_id);',
    '    drop_claim(node_id, "manual");',
    '    if (k >= 0) manual_clear_latch(k);',
    '    record_outcome(command_id, NS_TO[0], NS_REASON[0]);',
    '  } else {',
    '    int k = manual_pump_slot(node_id);',
    '    if (k >= 0) {',
    '      int rc = manual_pump_precheck(k);   // 0 ok, 1 source-low, 2 no local flow sensor',
    '      if (rc == 0) extend_deadman(node_id, "manual", 0);',
    '      record_outcome(command_id, NS_TO[rc], NS_REASON[rc]);',
    '    } else if (is_valve_node(node_id)) {',
    '      extend_deadman(node_id, "manual", 0);',
    '      record_outcome(command_id, NS_TO[0], NS_REASON[0]);',
    '    } else {',
    '      record_outcome(command_id, NS_TO[3], NS_REASON[3]);  // no local actuator',
    '    }',
    '  }',
    '} else if (strcmp(action, "safety_override") == 0) {',
    '  if (x["on"] | false) id(safety_override).turn_on(); else id(safety_override).turn_off();',
    '  record_outcome(command_id, "APPLIED", "");',
    ...configCases,
    '} else {',
    '  ESP_LOGW("cmd", "unknown action: %s", action);',
    '}',
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
  const BUFSZ = Math.max(2048, (readingCh.length + textCh.length + tunables.length) * 44 + m.routes.length * 192 + 1024);

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
    return `if (id(${c.ref}).state.length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${c.sensor}\\":\\"%s\\"", sep(), json_esc(id(${c.ref}).state.c_str())));`;
  };
  const routeLine = (i: number): string =>
    `{ int s = find_slot_by_route(${i}); int st = (s >= 0) ? slots[s].state : 0; ` +
    `const char* o = "SYSTEM"; const char* ac = ""; const char* rs = ""; ` +
    `if (s >= 0) { o = (slots[s].origin < 3) ? ORIGIN_TOK[slots[s].origin] : "SYSTEM"; ac = slots[s].actor; ` +
    `if (st == 4) { int f = slots[s].fault_code; if (f >= 0 && f < ${NF}) rs = FAULT_TOK[f]; } ` +
    `else if (st == 3 || st == 0) { int r = slots[s].stop_reason; if (r >= 0 && r < ${NR}) rs = STOP_TOK[r]; } } ` +
    `put(snprintf(buf+n, sizeof(buf)-n, "%s{\\"id\\":${i},\\"state\\":\\"%s\\",\\"origin\\":\\"%s\\",\\"actor\\":\\"%s\\",\\"reason\\":\\"%s\\"}", sep(), ` +
    `(st >= 0 && st < ${NS}) ? SYS_TOK[st] : "", o, ac, rs)); }`;

  const snapshotBody = [
    'auto *mc = id(mqtt_client);',
    'if (!mc->is_connected()) return;',
    cppTokenArray('SYS_TOK', SYSTEM_STATE_TOKENS),
    cppTokenArray('STOP_TOK', STOP_REASON_TOKENS),
    cppTokenArray('FAULT_TOK', FAULT_TOKENS),
    cppTokenArray('ORIGIN_TOK', ORIGIN_TOKENS),
    cppTokenArray('RR_TOK', RESET_REASON_TOKENS),
    `char buf[${BUFSZ}];`,
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
    ...tunables.map(t => `if (!std::isnan(id(${t.key}).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${t.key}\\":%g", sep(), id(${t.key}).state));`),
    `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${HEAP_FREE_SENSOR}\\":%u", sep(), (unsigned) esp_get_free_heap_size()));`,
    `put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${HEAP_MIN_SENSOR}\\":%u", sep(), (unsigned) esp_get_minimum_free_heap_size()));`,
    `if (!std::isnan(id(uptime_sec).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${UPTIME_SENSOR}\\":%g", sep(), id(uptime_sec).state));`,
    `if (!std::isnan(id(esp_temp).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${TEMP_SENSOR}\\":%g", sep(), id(esp_temp).state));`,
    ...(hasWifi ? [`if (!std::isnan(id(wifi_dbm).state)) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"${WIFI_SIGNAL_SENSOR}\\":%g", sep(), id(wifi_dbm).state));`] : []),
    'put(snprintf(buf+n, sizeof(buf)-n, "},\\"text\\":{"));',
    'first = true;',
    ...textCh.map(textLine),
    `{ int rr = (int) esp_reset_reason(); put(snprintf(buf+n, sizeof(buf)-n, "%s\\"reset_reason\\":\\"%s\\"", sep(), (rr >= 0 && rr < ${RESET_REASON_TOKENS.length}) ? RR_TOK[rr] : "UNKNOWN")); }`,
    'if (id(ip_addr).state.length()) put(snprintf(buf+n, sizeof(buf)-n, "%s\\"ip\\":\\"%s\\"", sep(), json_esc(id(ip_addr).state.c_str())));',
    `put(snprintf(buf+n, sizeof(buf)-n, "},\\"system\\":{\\"state\\":\\"%s\\",\\"queue\\":%d,\\"safety\\":%s},\\"routes\\":[", (id(system_state) >= 0 && id(system_state) < ${NS}) ? SYS_TOK[id(system_state)] : "", (int) id(queue_depth).state, id(safety_override).state ? "true" : "false"));`,
    'first = true;',
    ...m.routes.map((_r, i) => routeLine(i)),
    'put(snprintf(buf+n, sizeof(buf)-n, "],\\"outcomes\\":["));',
    'first = true;',
    'for (int k = 0; k < MAX_OUTCOMES; k++) { if (g_outcomes[k].command_id[0]) put(snprintf(buf+n, sizeof(buf)-n, "%s{\\"command_id\\":\\"%s\\",\\"result\\":\\"%s\\",\\"reason\\":\\"%s\\"}", sep(), g_outcomes[k].command_id, g_outcomes[k].result, g_outcomes[k].reason)); }',
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
  on_message:
    # Retained automation set (packed binary). Delivered on connect (retained
    # replay) and on every server-side change. The handler validates magic +
    # route_set_version and memcpy's it into the runtime table.
    - topic: "${automationsTopic(site, ctrl)}"
      qos: 1
      then:
        - lambda: |-
            apply_automation_set((const uint8_t *) x.data(), x.size());
${timeBlock}
interval:
  # Snapshot: publish the whole controller state every update interval while
  # connected. Re-asserted (self-healing) — the single source of truth; the server
  # projects it. No separate per-sensor or transition-event publishing.
  - interval: \${update_interval}
    then:
      - lambda: |-
${indent(snapshotBody, 10)}
`;
}
