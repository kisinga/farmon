import type { Manifest } from '@core';
import {
  MQTT_ROOT, telemetryTopic, commandTopic, statusTopic, eventTopic,
  collectTelemetryChannels, type TelemetryChannel,
  SYSTEM_STATE_TOKENS, STOP_REASON_TOKENS, FAULT_TOKENS,
  COMMAND_TTL_S, ROUTE_START_RESULTS, ROUTE_STOP_RESULTS, NODE_SET_RESULTS,
  localNodesWithFlag,
} from '@core';
import type { GenerationMetadata } from "../backends/types";
import { hasTimeSchedule } from "./schedule";

/** C++ printf format for a StateEvent JSON line: route, from, to, reason, command_id. */
const EVENT_FMT =
  '{\\"route\\":%d,\\"from\\":\\"%s\\",\\"to\\":\\"%s\\",\\"reason\\":\\"%s\\",\\"command_id\\":\\"%s\\"}';

/** A C++ `static const char* NAME[] = {"a", "b"};` literal from a token list. */
const cppTokenArray = (name: string, toks: readonly string[]) =>
  `static const char* ${name}[] = {${toks.map(t => `"${t}"`).join(', ')}};`;

/** Indent each non-empty C++ line to a column (YAML block-scalar body). */
const indent = (lines: string[], n: number) =>
  lines.map(l => (l === '' ? '' : ' '.repeat(n) + l)).join('\n');

/** One bare C++ publish statement for a channel, against the precomputed topic. */
function publishStmt(c: TelemetryChannel, topic: string): string {
  switch (c.kind) {
    case 'state':
      return `if (!std::isnan(id(${c.ref}).state)) mc->publish("${topic}", to_string(id(${c.ref}).state));`;
    case 'cover':
      return `if (!std::isnan(id(${c.ref}).position)) mc->publish("${topic}", to_string(id(${c.ref}).position));`;
    case 'bool':
      return `mc->publish("${topic}", id(${c.ref}).state ? "1" : "0");`;
    case 'enum': {
      const toks = c.tokens ?? [];
      const arr = toks.map(t => `"${t}"`).join(', ');
      return `{ static const char* T[] = {${arr}}; int v = id(${c.ref}); ` +
        `if (v >= 0 && v < ${toks.length}) mc->publish("${topic}", T[v]); }`;
    }
  }
}

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
export function generateMqtt(m: Manifest, metadata: GenerationMetadata): string {
  const site = metadata.siteId;
  const ctrl = metadata.controllerId;
  const ev = eventTopic(site, ctrl);
  const NS = SYSTEM_STATE_TOKENS.length;
  const NF = FAULT_TOKENS.length;
  const NR = STOP_REASON_TOKENS.length;

  // The shared channel enumeration (system-wide channels, then per-node) — the
  // same list the dashboard chart spec builds widgets from, so what the firmware
  // publishes and what the UI reads can never drift.
  const channels = collectTelemetryChannels(m);
  const hasManualPumps = localNodesWithFlag(m, 'isPump').length > 0;

  // SNTP wall clock for the command TTL gate. Emit it here UNLESS an on-device
  // time schedule already declares `time: sntp` (id: sntp_time) — that way there
  // is exactly one sntp_time and we never depend on ESPHome package merge-by-id.
  const timeBlock = hasTimeSchedule(m)
    ? ''
    : '\ntime:\n  - platform: sntp\n    id: sntp_time\n    on_time_sync:\n      - then:\n          - lambda: \'id(time_trusted) = true;\'\n';

  // --- Shared event helper ---------------------------------------------------
  // One lambda-local C++ helper, embedded in both the command handler and the
  // transition log, so the snprintf + publish is written once. Best-effort: it
  // skips silently when the broker is disconnected.
  const publishEventHelper = [
    'auto publish_event = [](int route, const char* from, const char* to, const char* reason, const char* cid) {',
    '  auto *mc = id(mqtt_client);',
    '  if (!mc->is_connected()) return;',
    '  char payload[192];',
    `  snprintf(payload, sizeof(payload), "${EVENT_FMT}", route, from, to, reason, cid);`,
    `  mc->publish("${ev}", payload);`,
    '};',
  ];

  // --- Operator command handler (JSON on the command topic) ------------------
  // A stale command (issued before the TTL window) is refused outright. Route
  // refusals/queues become a transition event carrying the reason via the rc →
  // {to, reason} tables from core (no magic numbers); a successful start (rc 0)
  // needs no event here — the transition log below catches the PREPARING edge.
  const cmdBody = [
    ...publishEventHelper,
    'const char* action = x["action"] | "";',
    'const char* command_id = x["command_id"] | "";',
    '',
    '// TTL gate: once time is TRUSTED (a real SNTP sync, not the flash-seeded boot',
    '// estimate), drop a command older than the window (e.g. one queued while the link',
    '// was down) and report it as STALE. Untrusted clock → skip the gate (fail-open).',
    'auto _t = id(sntp_time).now();',
    'long long issued_at = x["issued_at"] | 0LL;',
    `if (id(time_trusted) && issued_at > 0 && (long long)_t.timestamp - issued_at > ${COMMAND_TTL_S}) {`,
    '  publish_event(-1, "", "REFUSED", "STALE", command_id);',
    '  return;',
    '}',
    '',
    'int route_id = x["route_id"] | -1;',
    'if (strcmp(action, "route_start") == 0) {',
    `  ${cppTokenArray('RS_TO', ROUTE_START_RESULTS.map(r => r.to))}`,
    `  ${cppTokenArray('RS_REASON', ROUTE_START_RESULTS.map(r => r.reason))}`,
    '  int rc = try_route_start(route_id, command_id);',
    `  if (rc > 0 && rc < ${ROUTE_START_RESULTS.length}) publish_event(route_id, "", RS_TO[rc], RS_REASON[rc], command_id);`,
    '} else if (strcmp(action, "route_stop") == 0) {',
    `  ${cppTokenArray('RST_REASON', ROUTE_STOP_RESULTS.map(r => r.reason))}`,
    '  int rc = try_route_stop(route_id, command_id);',
    `  if (rc > 0 && rc < ${ROUTE_STOP_RESULTS.length}) publish_event(route_id, "", "REFUSED", RST_REASON[rc], command_id);`,
    '} else if (strcmp(action, "fault_reset") == 0) {',
    '  int s = find_slot_by_route(route_id);',
    '  if (s >= 0 && slots[s].state == 4) { init_slot(s); id(system_state) = derived_system_state(); }',
    '} else if (strcmp(action, "stop_all") == 0) {',
    '  id(btn_stop_all).press();',
    '} else if (strcmp(action, "reset_faults") == 0) {',
    '  id(btn_reset_faults).press();',
    '} else if (strcmp(action, "clear_queue") == 0) {',
    '  id(btn_clear_queue).press();',
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
    '    publish_event(-1, "", NS_TO[0], NS_REASON[0], command_id);',
    '  } else {',
    '    int k = manual_pump_slot(node_id);',
    '    if (k >= 0) {',
    '      int rc = manual_pump_precheck(k);   // 0 ok, 1 source-low, 2 no local flow sensor',
    '      if (rc == 0) extend_deadman(node_id, "manual", 0);',
    '      publish_event(-1, "", NS_TO[rc], NS_REASON[rc], command_id);',
    '    } else if (is_valve_node(node_id)) {',
    '      extend_deadman(node_id, "manual", 0);',
    '      publish_event(-1, "", NS_TO[0], NS_REASON[0], command_id);',
    '    } else {',
    '      publish_event(-1, "", NS_TO[3], NS_REASON[3], command_id);  // no local actuator',
    '    }',
    '  }',
    '} else if (strcmp(action, "safety_override") == 0) {',
    '  if (x["on"] | false) id(safety_override).turn_on(); else id(safety_override).turn_off();',
    '} else {',
    '  ESP_LOGW("cmd", "unknown action: %s", action);',
    '}',
  ];

  // MQTT here is the device↔server pipe: telemetry up, commands down. Cross-controller
  // coordination is device↔device over UDP (packages/coordination.{h,yaml}).

  // --- Telemetry publisher (every update interval) ---------------------------
  const telemetryBody = [
    'auto *mc = id(mqtt_client);',
    'if (!mc->is_connected()) return;',
    ...channels.map(c => publishStmt(c, telemetryTopic(site, ctrl, c.sensor))),
  ];

  // --- Transition log (per-slot edge detection, 1s) -------------------------
  // Diffs each slot's state against the previous tick and emits one StateEvent
  // per change. The reason rides only on terminal states (FAULT → fault token,
  // STOPPING/IDLE → stop reason). last_route survives the slot resetting to -1
  // so a stop event still names the route that just ran.
  const eventBody = [
    ...publishEventHelper,
    'auto *mc = id(mqtt_client);',
    'if (!mc->is_connected()) return;',
    cppTokenArray('SYS_TOK', SYSTEM_STATE_TOKENS),
    cppTokenArray('STOP_TOK', STOP_REASON_TOKENS),
    cppTokenArray('FAULT_TOK', FAULT_TOKENS),
    'static int last_state[MAX_CONCURRENT_ROUTES];',
    'static int last_route[MAX_CONCURRENT_ROUTES];',
    'static bool seeded = false;',
    'if (!seeded) {',
    '  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) { last_state[i] = slots[i].state; last_route[i] = slots[i].route_id; }',
    '  seeded = true;',
    '  return;',
    '}',
    'for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {',
    '  int cur = slots[s].state;',
    '  if (cur == last_state[s]) continue;',
    '  int rid = slots[s].route_id >= 0 ? slots[s].route_id : last_route[s];',
    `  const char* from = (last_state[s] >= 0 && last_state[s] < ${NS}) ? SYS_TOK[last_state[s]] : "";`,
    `  const char* to = (cur >= 0 && cur < ${NS}) ? SYS_TOK[cur] : "";`,
    '  const char* reason = "";',
    `  if (cur == 4) { int f = slots[s].fault_code; if (f >= 0 && f < ${NF}) reason = FAULT_TOK[f]; }`,
    `  else if (cur == 3 || cur == 0) { int r = slots[s].stop_reason; if (r >= 0 && r < ${NR}) reason = STOP_TOK[r]; }`,
    '  publish_event(rid, from, to, reason, "");',
    '  last_state[s] = cur;',
    '}',
    'for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) { if (slots[s].route_id >= 0) last_route[s] = slots[s].route_id; }',
    // Manual/claim pump guard latch transitions → timeline. The node-identified
    // truth is the relay shadow (telemetry); this carries the reason. No command_id
    // (the trip is async, the original command is long gone).
    ...(hasManualPumps ? [
      'static int last_latch[NUM_MANUAL_PUMPS];',
      'for (int k = 0; k < NUM_MANUAL_PUMPS; k++) {',
      '  if (manual_latch[k] == last_latch[k]) continue;',
      `  if (manual_latch[k] > 0 && manual_latch[k] < ${NR}) publish_event(-1, "", "REFUSED", STOP_TOK[manual_latch[k]], "");`,
      '  last_latch[k] = manual_latch[k];',
      '}',
    ] : []),
  ];

  return `# =============================================================================
# MajiFlow — MQTT Runtime
# =============================================================================
# AUTO-GENERATED. Replaces Home Assistant as the runtime transport.
#
# - Telemetry: published explicitly on majiflow/${site}/${ctrl}/telemetry/<id>
#   (absolute topics, set in the lambdas below). Numbers ride as numbers;
#   system_state / stop_reason ride as human-readable tokens.
# - Events:    each state change is appended on majiflow/${site}/${ctrl}/event
#   as a StateEvent JSON (route, from, to, reason, command_id).
# - Commands:  operator actions arrive as JSON on the command topic and are
#   dispatched into the existing route/queue functions (routes.h / control); a
#   refused/queued command emits a transition event carrying the reason.
# - Status:    retained birth/will on the status topic for online/offline.
#
# Mode: ${metadata.mode}. Broker: ${metadata.brokerAddress}:${metadata.brokerPort}.
# =============================================================================

mqtt:
  id: mqtt_client
  broker: "${metadata.brokerAddress}"
  port: ${metadata.brokerPort}
  username: "${ctrl}"
  password: !secret mqtt_token
  discovery: false
  # Controller runs local control (routes, safety, UDP peer coordination)
  # autonomously and is an island when the server is down. An unreachable or
  # rejecting broker must never reboot it. 0s disables ESPHome's 15-min default.
  reboot_timeout: 0s
  # We publish our own telemetry/event/status on absolute topics (in the lambdas
  # below). ESPHome still auto-publishes each entity's state under topic_prefix;
  # we segregate those under .../esphome/* so they never collide with our scheme
  # (the server's parsers key on the 4th segment being telemetry/event/status).
  # An empty prefix is no longer accepted by ESPHome (cv.publish_topic).
  topic_prefix: "${MQTT_ROOT}/${site}/${ctrl}/esphome"
  birth_message:
    topic: "${statusTopic(site, ctrl)}"
    payload: "1"
    retain: true
  will_message:
    topic: "${statusTopic(site, ctrl)}"
    payload: "0"
    retain: true
  on_json_message:
    - topic: "${commandTopic(site, ctrl)}"
      then:
        - lambda: |-
${indent(cmdBody, 12)}
${timeBlock}
interval:
  # Telemetry: publish every channel each update interval while connected.
  - interval: \${update_interval}
    then:
      - lambda: |-
${indent(telemetryBody, 10)}

  # Transitions: detect per-slot state edges every second and append events.
  - interval: 1s
    then:
      - lambda: |-
${indent(eventBody, 10)}
`;
}
