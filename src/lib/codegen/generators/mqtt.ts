import type { Manifest, LocalManifestNode } from '@core';
import {
  telemetrySensorId, telemetryTopic, commandTopic, statusTopic, eventTopic,
  SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR,
  SYSTEM_STATE_TOKENS, STOP_REASON_TOKENS, FAULT_TOKENS,
} from '@core';
import type { GenerationMetadata } from "../backends/types";

/**
 * A single telemetry value the firmware publishes.
 *  - `state`  reads `id(<sensor>).state`    (numeric sensor; NaN-guarded)
 *  - `bool`   reads `id(<sensor>).state`    (switch; published as 1/0)
 *  - `cover`  reads `id(<sensor>).position` (time_based cover; NaN-guarded)
 *  - `enum`   reads `id(<global>)` (int) and publishes the matching wire token
 *             from `tokens` (index === code), e.g. system_state 2 → "RUNNING"
 */
type ChannelKind = 'state' | 'bool' | 'cover' | 'enum';
interface Channel {
  /** The `sensor` segment on the wire — also the ESPHome component id. */
  sensor: string;
  /** The ESPHome id whose value is read (component id, or global name). */
  ref: string;
  kind: ChannelKind;
  /** For `enum`: wire tokens indexed by the firmware's integer code. */
  tokens?: readonly string[];
}

/** C++ printf format for a StateEvent JSON line: route, from, to, reason, command_id. */
const EVENT_FMT =
  '{\\"route\\":%d,\\"from\\":\\"%s\\",\\"to\\":\\"%s\\",\\"reason\\":\\"%s\\",\\"command_id\\":\\"%s\\"}';

/** A C++ `static const char* NAME[] = {"a", "b"};` literal from a token list. */
const cppTokenArray = (name: string, toks: readonly string[]) =>
  `static const char* ${name}[] = {${toks.map(t => `"${t}"`).join(', ')}};`;

/** Indent each non-empty C++ line to a column (YAML block-scalar body). */
const indent = (lines: string[], n: number) =>
  lines.map(l => (l === '' ? '' : ' '.repeat(n) + l)).join('\n');

/**
 * Build the list of telemetry channels for a controller's local nodes. Mirrors
 * each entity's emit conditions exactly so we never publish an id() that the
 * other generators didn't create.
 */
function collectChannels(m: Manifest): Channel[] {
  const channels: Channel[] = [];
  const num = (node: LocalManifestNode, role: Parameters<typeof telemetrySensorId>[1]) =>
    channels.push({ sensor: telemetrySensorId(node, role), ref: telemetrySensorId(node, role), kind: 'state' });

  for (const node of m.nodes) {
    switch (node.kind) {
      case 'pump':
        channels.push({ sensor: telemetrySensorId(node, 'pump'), ref: telemetrySensorId(node, 'pump'), kind: 'bool' });
        break;
      case 'dosing_pump':
        channels.push({ sensor: telemetrySensorId(node, 'dosing'), ref: telemetrySensorId(node, 'dosing'), kind: 'bool' });
        break;
      case 'valve':
        channels.push({ sensor: telemetrySensorId(node, 'valve'), ref: telemetrySensorId(node, 'valve'), kind: 'cover' });
        break;
      case 'flow_sensor':
        num(node, 'flow');
        num(node, 'flow_total');
        break;
      case 'tank':
        if (node['pressure_pin']) num(node, 'level');
        break;
      case 'water_source':
        if (node['pressure_pin']) num(node, 'pressure');
        break;
      case 'filter':
        if (node['inlet_pressure_pin']) num(node, 'filter_inlet');
        if (node['outlet_pressure_pin']) num(node, 'filter_outlet');
        if (node['inlet_pressure_pin'] && node['outlet_pressure_pin']) num(node, 'filter_delta');
        break;
      // vfd: no telemetry channel yet
    }
  }
  return channels;
}

/** One bare C++ publish statement for a channel, against the precomputed topic. */
function publishStmt(c: Channel, topic: string): string {
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

  // System-wide channels (always present), then per-node channels. system_state
  // and stop_reason ride as enum tokens; queue depth + safety override are plain.
  const channels: Channel[] = [
    { sensor: SYSTEM_STATE_SENSOR, ref: 'system_state', kind: 'enum', tokens: SYSTEM_STATE_TOKENS },
    { sensor: STOP_REASON_SENSOR, ref: 'stop_reason', kind: 'enum', tokens: STOP_REASON_TOKENS },
    { sensor: 'queue_depth', ref: 'queue_depth', kind: 'state' },
    { sensor: 'safety_override', ref: 'safety_override', kind: 'bool' },
    ...collectChannels(m),
  ];

  // --- Operator command handler (JSON on the command topic) ------------------
  // Refusals/queues become a transition event carrying the reason; a successful
  // start (rc 0) needs no event here — the diff below logs the PREPARING edge.
  const cmdBody = [
    'const char* action = x["action"] | "";',
    'const char* command_id = x["command_id"] | "";',
    'int route_id = x["route_id"] | -1;',
    'auto *mc = id(mqtt_client);',
    'if (strcmp(action, "route_start") == 0) {',
    '  int rc = try_route_start(route_id, command_id);',
    '  if (rc != 0) {',
    '    const char* to = (rc == 1) ? "QUEUED" : "REFUSED";',
    '    const char* reason = "";',
    '    if (rc == 3) reason = "SOURCE_LOW";',
    '    else if (rc == 4) reason = "TANK_FULL";',
    '    else if (rc == 5) reason = "CONTROL_LOST";',
    '    else if (rc == 2) reason = "REJECTED";',
    '    char payload[192];',
    `    snprintf(payload, sizeof(payload), "${EVENT_FMT}", route_id, "", to, reason, command_id);`,
    `    mc->publish("${ev}", payload);`,
    '  }',
    '} else if (strcmp(action, "route_stop") == 0) {',
    '  int rc = try_route_stop(route_id, command_id);',
    '  if (rc != 0) {',
    '    const char* reason = (rc == 1) ? "NOT_ACTIVE" : "NOT_RUNNING";',
    '    char payload[192];',
    `    snprintf(payload, sizeof(payload), "${EVENT_FMT}", route_id, "", "REFUSED", reason, command_id);`,
    `    mc->publish("${ev}", payload);`,
    '  }',
    '} else if (strcmp(action, "fault_reset") == 0) {',
    '  int s = find_slot_by_route(route_id);',
    '  if (s >= 0 && slots[s].state == 4) {',
    '    init_slot(s);',
    '    id(system_state) = derived_system_state();',
    '  }',
    '} else if (strcmp(action, "stop_all") == 0) {',
    '  id(btn_stop_all).press();',
    '} else if (strcmp(action, "reset_faults") == 0) {',
    '  id(btn_reset_faults).press();',
    '} else if (strcmp(action, "clear_queue") == 0) {',
    '  id(btn_clear_queue).press();',
    '} else {',
    '  ESP_LOGW("cmd", "unknown action: %s", action);',
    '}',
  ];

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
    '  char payload[192];',
    `  snprintf(payload, sizeof(payload), "${EVENT_FMT}", rid, from, to, reason, "");`,
    `  mc->publish("${ev}", payload);`,
    '  last_state[s] = cur;',
    '}',
    'for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) { if (slots[s].route_id >= 0) last_route[s] = slots[s].route_id; }',
  ];

  return `# =============================================================================
# MajiFlow — MQTT Runtime
# =============================================================================
# AUTO-GENERATED. Replaces Home Assistant as the runtime transport.
#
# - Telemetry: published explicitly on majiflow/${site}/${ctrl}/telemetry/<id>
#   (automatic per-entity topics are disabled via empty topic_prefix). Numbers
#   ride as numbers; system_state / stop_reason ride as human-readable tokens.
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
  # Empty prefix disables ESPHome's automatic per-entity topics — we publish
  # exactly the telemetry we want, on our own scheme, below.
  topic_prefix: ""
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
