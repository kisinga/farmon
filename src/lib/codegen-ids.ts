/**
 * Shared codegen ID conventions — the single source of truth for all
 * ESPHome component IDs used across entity codegen and generators.
 *
 * Both sides import from here: entity codegen uses these to build YAML
 * templates, generators use them in dispatch functions and control logic.
 * If a convention changes, it changes in one place.
 */

import type { BoardDef } from './board.types';
import type { TopologyNode } from './topology.types';

// ---------------------------------------------------------------------------
// Component IDs — pump
// ---------------------------------------------------------------------------

export const pumpSwitchId = (nodeId: string) => `${nodeId}_relay`;

// ---------------------------------------------------------------------------
// Component IDs — valve
// ---------------------------------------------------------------------------

export const valveCoverId = (node: { id: string }) => node.id;
export const valveOpenPinId = (node: { id: string }) => `${node.id}_open_pin`;
export const valveClosePinId = (node: { id: string }) => `${node.id}_close_pin`;
export const valveTravelTimeId = (node: { id: string }) => `${node.id}_travel_s`;

// ---------------------------------------------------------------------------
// Component IDs — flow sensor
// ---------------------------------------------------------------------------

export const flowSensorId = (node: { id: string }) => node.id;
export const flowTotalId = (node: { id: string }) => `${node.id}_total`;
export const flowFaultCountId = (node: { id: string }) => `${node.id}_fault_count`;
export const flowFaultSensorId = (node: { id: string }) => `${node.id}_sensor_fault`;

// ---------------------------------------------------------------------------
// Component IDs — pressure sensor
// ---------------------------------------------------------------------------

export const pressureSensorId         = (n: { id: string }) => `${n.id}_pressure`;
export const pressureSensorCalEmptyId = (n: { id: string }) => `${n.id}_cal_empty`;
export const pressureSensorCalFullId  = (n: { id: string }) => `${n.id}_cal_full`;
export const pressureSensorLevelId    = (n: { id: string }) => `${n.id}_level`;

// ---------------------------------------------------------------------------
// Component IDs — water source
// ---------------------------------------------------------------------------

export const waterSourcePressureId = (node: { id: string }) => `${node.id}_pressure`;

// ---------------------------------------------------------------------------
// Component IDs — dosing pump
// ---------------------------------------------------------------------------

export const dosingPumpSwitchId = (node: { id: string }) => `${node.id}_relay`;

// ---------------------------------------------------------------------------
// Component IDs — filter
// ---------------------------------------------------------------------------

export const filterInletPressureId = (node: { id: string }) => `${node.id}_inlet_pressure`;
export const filterOutletPressureId = (node: { id: string }) => `${node.id}_outlet_pressure`;
export const filterDeltaPressureId = (node: { id: string }) => `${node.id}_delta_pressure`;

// ---------------------------------------------------------------------------
// Component IDs — automation (schedule)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pin resolution — maps a logical pin name to an ESPHome YAML pin block
// ---------------------------------------------------------------------------

/**
 * Resolve a pin name to an ESPHome YAML pin block.
 *
 * For native GPIO pins (e.g. "GPIO42"), returns a simple `number:` block.
 * For expander pins (e.g. "OUT1"), looks up the expander and port number
 * from the board definition and returns a structured block.
 *
 * The returned string is zero-indented — each additional key-value is on its
 * own line with no leading whitespace. Callers handle indentation via
 * yaml-fragment utilities or template literal positioning.
 */
export function resolvePinYaml(
  pinName: string,
  board: BoardDef,
  opts?: { inverted?: boolean; mode?: string },
): string {
  if (!pinName) return 'number: ""';

  // Find the pin in the board definition
  const pinDef = board.pins.find(p => p.gpio === pinName);

  // Expander pin — structured block
  if (pinDef?.expander != null && pinDef.number != null) {
    const expander = board.expanders?.find(e => e.id === pinDef.expander);
    if (!expander) {
      throw new Error(`Pin ${pinName} references unknown expander "${pinDef.expander}"`);
    }
    // Match the canonical KC868/PCF8574 ESPHome examples: `mode: OUTPUT` /
    // `mode: INPUT` (string form). ESPHome accepts both string and structured
    // (`{ output: true }`) forms identically; using the string form makes our
    // YAML byte-identical to every published reference config for these chips.
    const isOutput = opts?.mode?.toUpperCase().includes('OUTPUT');
    const mode = isOutput ? 'OUTPUT' : 'INPUT';
    const lines = [
      `${expander.platform}: ${pinDef.expander}`,
      `number: ${pinDef.number}`,
      `mode: ${mode}`,
    ];
    if (opts?.inverted) lines.push(`inverted: true`);
    return lines.join('\n    ');
  }

  // Native GPIO pin — simple block
  const lines = [`number: ${pinName}`];
  if (opts?.mode) lines.push(`mode: ${opts.mode}`);
  if (opts?.inverted) lines.push(`inverted: true`);
  return lines.join('\n    ');
}

// ===========================================================================
// Runtime contract — deployment mode, MQTT topics, command vocabulary.
//
// These strings cross the wire to the firmware (C++) and the broker/server
// (Go). They are defined ONCE here and mirrored — not imported — on those
// sides (e.g. ParseTopic in maji-server/internal/telemetry/ingest.go). The
// round-trip test in test/ asserts the two sides agree.
// ===========================================================================

// ---------------------------------------------------------------------------
// Deployment mode — the only runtime distinction the firmware knows about.
// (Pricing tiers are a separate billing concern and are never baked in.)
// ---------------------------------------------------------------------------

/**
 * Runtime mode a controller is built and validated for.
 *  - `managed`: device ↔ our cloud broker; cloud DB is the source of truth.
 *    Controllers can't coordinate — each is an island limited to what it can
 *    physically wire to itself.
 *  - `local`: device ↔ an on-site broker; the on-site box is the source of
 *    truth. Controllers may coordinate (peer dead-man leasing, cross-
 *    controller routes).
 */
export type DeploymentMode = 'managed' | 'local';

// ---------------------------------------------------------------------------
// MQTT topics — wire namespace shared with the broker/server.
// ---------------------------------------------------------------------------

/** Root segment of every MajiFlow MQTT topic. */
export const MQTT_ROOT = 'majiflow';

/**
 * Telemetry publish topic (device → broker → ingest):
 *   majiflow/{site}/{ctrl}/telemetry/{sensor}
 * `sensor` is the ESPHome component id — build it with telemetrySensorId().
 * The server parses this exact shape in ParseTopic().
 */
export const telemetryTopic = (site: string, ctrl: string, sensor: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/telemetry/${sensor}`;

/**
 * Operator command topic (server → broker → device):
 *   majiflow/{site}/{ctrl}/command
 * One topic per controller; the JSON payload is a CommandEnvelope. Sits inside
 * the device's ACL namespace (majiflow/{site}/{ctrl}/…), so the device can
 * subscribe without any ACL change.
 */
export const commandTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/command`;

/**
 * Retained automation-set topic (server → broker → device):
 *   majiflow/{site}/{ctrl}/automations
 * One RETAINED packed-binary message per controller (see automation-wire.ts).
 * Retained = a rebooting/reprovisioning device pulls the current set on connect.
 * The server republishes the whole set on any automation change; the device
 * memcpy's it into its runtime table. Inside the device ACL namespace.
 */
export const automationsTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/automations`;

/**
 * Online/offline status topic (retained birth/will, device → broker):
 *   majiflow/{site}/{ctrl}/status   payload "1" (online) / "0" (offline)
 * Deliberately outside the `…/telemetry/…` namespace so the telemetry ingest
 * hook ignores it — online/offline is tracked separately from sample ingest.
 */
export const statusTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/status`;

/**
 * Retained hardware-identity topic (device → broker):
 *   majiflow/{site}/{ctrl}/identity   payload = the chip's base MAC (get_mac_address()).
 * Published RETAINED on every connect. The server binds a controller to the first MAC it
 * sees and flags any later board reporting a different one — the duplicate-firmware
 * tripwire (two boards flashed with one baked identity). Inside the device ACL namespace,
 * and deliberately outside `…/telemetry/…` so the numeric ingest hook ignores it.
 */
export const identityTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/identity`;

/**
 * Transition-event topic (append-only state log, device → broker → ingest):
 *   majiflow/{site}/{ctrl}/event
 * The JSON payload is a StateEvent. Deliberately outside the `…/telemetry/…`
 * namespace so the numeric ingest hook ignores it — a dedicated event hook
 * appends the row to `state_events` and refreshes the shadow. Sits inside the
 * device's ACL namespace, so no ACL change is needed to publish it.
 */
export const eventTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/event`;

/**
 * Controller state snapshot topic (device → broker → ingest):
 *   majiflow/{site}/{ctrl}/state
 * ONE JSON {@link ControllerSnapshot} re-asserted every interval — the single
 * source of truth. The server projects it: latest → controller_state doc, numeric
 * readings → telemetry_raw (rollups), route/system changes → derived state_events.
 * Replaces the per-sensor telemetry topic, the route-state token, and the lossy
 * event log. Inside the device ACL namespace.
 */
export const snapshotTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/state`;

/**
 *   majiflow/{site}/{ctrl}/runs_ack
 * Retained "epoch:seq" high-water-mark the server publishes after persisting the
 * billing runs the device asserts in the snapshot runs[] outbox. The device drops
 * every run at or below it from its durable outbox. One retained value acks an
 * arbitrary backlog and survives reconnects. Mirrors RunsAckTopic() in the Go server.
 */
export const runsAckTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/runs_ack`;

/**
 * Retained desired-config topic (server → broker → device):
 *   majiflow/{site}/{ctrl}/config
 * ONE RETAINED JSON message: the server-owned "desired controller config" — the
 * runtime tunables + calibration anchors as a flat `{ <number_id>: <value> }` kv,
 * plus an opaque `version` string the SERVER computes (a canonical hash, computed
 * Go-side only at publish time). The device NEVER hashes: it applies each kv entry
 * to the matching `number:` entity via make_call().set_value().perform() and
 * round-trips `version` back verbatim as the snapshot text `config_version`, which
 * the server compares against the version it published (desired-vs-applied
 * reconcile). Retained ⇒ a rebooting/reprovisioning device pulls the current config
 * on connect; the server republishes on any change. Inside the device ACL namespace.
 * Mirrors ConfigTopic() in the Go server.
 */
export const configTopic = (site: string, ctrl: string) =>
  `${MQTT_ROOT}/${site}/${ctrl}/config`;


/** Fixed (non-node) telemetry sensor ids the firmware always publishes. */
export const SYSTEM_STATE_SENSOR = 'system_state';
export const STOP_REASON_SENSOR = 'stop_reason';

/** Telemetry `sensor` segment for a route's self-healing current state
 *  (`route_<id>_state`). Published every interval and read by the dashboard, so a
 *  dropped one-shot transition event never strands the route card. `routeId` is
 *  the firmware ROUTES[] index (== the dashboard's routeId). */
export const routeStateSensor = (routeId: number): string => `route_${routeId}_state`;

/** ESPHome `number:` id for a route's runtime-tunable tank-% setpoints. This one
 *  string is the firmware entity id, the desired-config kv key (configTopic), the
 *  telemetry sensor the current value is published under, AND the id the dashboard
 *  editor reads/writes — single-sourced so none of those four can drift. */
export const routeSourceMinNumber = (routeId: number): string => `route_${routeId}_source_min_pct`;
export const routeDestMaxNumber = (routeId: number): string => `route_${routeId}_dest_max_pct`;

// ---------------------------------------------------------------------------
// Command vocabulary — issued by the dashboard, relayed + audited by the
// server, handled by the firmware. Mirrors the legacy HA api: services and the
// system-wide control buttons.
// ---------------------------------------------------------------------------

/** Operator commands, server-mediated (durable audit + authz). */
export type CommandAction =
  | 'route_start'      // { route_id }
  | 'route_stop'       // { route_id }
  | 'fault_reset'      // { route_id }
  | 'stop_all'         // (no args)
  | 'reset_faults'     // (no args)
  | 'clear_queue'      // (no args)
  | 'node_set'         // { node_id, on } — manual claim/release of any actuator
  | 'safety_override'; // { on } — toggle the commissioning bypass switch (see note)

/**
 * Commands older than this many seconds (now - issued_at, by the device's SNTP
 * clock) are ignored as stale, so a command queued while the link was down can
 * never fire on reconnect. The firmware gates on it; the dashboard uses it for
 * the "expires in ~Ns" offline warning. One definition, both sides read it.
 */
export const COMMAND_TTL_S = 120;

/**
 * The JSON body on commandTopic(). `command_id` correlates the request with the
 * device's reported result so the dashboard can show a pending → done state.
 * `issued_at` (unix seconds, stamped by the server) is the staleness clock the
 * device checks against COMMAND_TTL_S — see the TTL gate in the firmware handler.
 * `actor` is the issuing user's id; the device stores it on the run's slot and
 * re-publishes it as the route's origin so the dashboard can show "by <name>".
 */
export type CommandEnvelope = { command_id: string; issued_at: number; actor?: string } & (
  | {
      action: 'route_start' | 'route_stop' | 'fault_reset'; route_id: number;
      // route_start only: a per-run StopSpec. `override_mask` selects which `ov_*`
      // fields are active (see OVERRIDE_BITS); an unset field falls through to the
      // route's baked/live tunable on the device. Absent ⇒ run on the route's
      // tunables (the pre-targeted-runs behaviour). route_stop / fault_reset ignore them.
      override_mask?: number; ov_source_min_pct?: number; ov_dest_max_pct?: number;
      ov_max_runtime_min?: number; ov_target_duration_s?: number; ov_target_volume_l?: number;
    }
  | { action: 'stop_all' | 'reset_faults' | 'clear_queue' }
  // node_set: claim (on) / release (off) any actuator via the dead-man registry
  // the reconciler already honours — a claim runs a pump / opens a valve, and the
  // lease expiring (heartbeat stops) fail-safe stops/closes it.
  | { action: 'node_set'; node_id: string; on: boolean }
  // safety_override: the commissioning BYPASS switch. ON disables every runtime
  // safety check (pre-start level gates, flow watchdog, runtime stops, max-runtime)
  // and lets a pump run without an owning route. Enabling it is dangerous — gate
  // behind a hard confirm. Reverts to OFF on device reboot.
  | { action: 'safety_override'; on: boolean }
  // Runtime tunables / calibration are NOT set by an operator command anymore: the
  // dashboard writes the desired config to the DB, the server recomputes the retained
  // /config message (configTopic), and the device applies each number entity from it.
  // The old one-shot `config_set` command is gone (no back-compat).
  // firmware_update: pull-OTA. NOT an operator /command action — it is published
  // only by the server's /firmware/deploy endpoint, so it is absent from the generic
  // commandActions allow-list. The device fetches the image at `url` and flashes it
  // after verifying it against `md5` (delivered over this trusted lane); it no-ops if
  // `version` already matches the running build. See the firmware_update handler.
  | { action: 'firmware_update'; version: string; url: string; md5: string }
);

// ---------------------------------------------------------------------------
// Cross-controller coordination message — carried controller→controller over the
// UDP lane (ESPHome `udp:` udp.write/on_receive, LAN broadcast). One definition
// both firmware ends build and parse.
//
// `on_receive` does not expose the packet source, so the sender's controller id
// travels in `from`. Each message is authenticated by `mac` = HMAC-SHA256(udp_key,
// canonical bytes), with `c` a per-sender monotonic counter for replay protection;
// the receiver verifies `mac` and that `c` advanced before acting. Authenticity
// only — claims are not secret, so there is no confidentiality.
// ---------------------------------------------------------------------------

/** Wire field names — emit (importer) and parse (owner) share these, no drift. */
export const COORD_MSG = {
  type: 't',
  from: 'from',
  counter: 'c',
  mac: 'mac',
  node: 'node_id',
  role: 'role',
  value: 'value',
} as const;

/** Message kinds carried on the coordination UDP lane. */
export const COORD_TYPE = {
  claim: 'claim',     // importer → owner: keep this node active (run pump / open valve)
  release: 'release', // importer → owner: relinquish it (stop / close)
  reading: 'reading', // owner → importer: a sensor value for a node the owner holds
} as const;

/**
 * The JSON body of every coordination udp.write. `from` is the sender controller
 * id (== the maji_claims registry's claim-holder key). A claim/release drives
 * `id(claims).extend`/`id(claims).drop` on the owner; a reading populates the
 * importer's `ri_<node_id>` mirror sensor.
 */
export type CoordMessage = { from: string; c: number; mac: string } & (
  | { t: 'claim'; node_id: string }
  | { t: 'release'; node_id: string }
  | { t: 'reading'; node_id: string; role: TelemetryRole; value: number }
);

// ---------------------------------------------------------------------------
// Telemetry sensor id — bridges a topology node + channel to the ESPHome
// component id published as the `sensor` segment of telemetryTopic(). The
// firmware publisher and the dashboard chart bindings both call this so they
// agree on the wire string; it is backed by the per-entity id helpers above.
// ---------------------------------------------------------------------------

/** A telemetry channel a node can publish. Not every role applies to every kind. */
export type TelemetryRole =
  | 'flow'          // flow rate              (flow_sensor)
  | 'flow_total'    // cumulative volume      (flow_sensor)
  | 'level'         // tank level %           (tank)
  | 'pressure'      // line/source pressure   (water_source)
  | 'pump'          // pump relay on/off      (pump)
  | 'valve'         // valve open/closed      (valve)
  | 'dosing'        // dosing relay on/off    (dosing_pump)
  | 'filter_inlet'  // filter inlet pressure  (filter)
  | 'filter_outlet' // filter outlet pressure (filter)
  | 'filter_delta'; // filter delta pressure  (filter)

/** How a role's reading becomes a live state:
 *  - `binary`   on/off from a relay/cover (energised / open).
 *  - `positive` numeric where >0 means active (flow rate flowing).
 *  - `value`    numeric carrying no on/off — the magnitude is the meaning (level, pressure). */
export type RoleStateKind = 'binary' | 'positive' | 'value';

/** A telemetry role's complete SEMANTIC profile — facts a non-UI consumer shares
 *  (firmware emits these units; alarms compare these ranges; `stateKind` is what
 *  the reading means). Single source for unit/range/state/salience; carries no
 *  pixels. The dashboard's `ROLE_PRESENTATION` derives unit/range from here, and
 *  the live projection derives state/active/fill from here. */
export interface RoleMeta {
  /** Display/engineering unit, e.g. 'L/min', '%', 'psi'. */
  unit?: string;
  /** Value bounds (for normalised fill / gauges). */
  min?: number;
  max?: number;
  /** Which channel best represents a node that emits several (higher wins). */
  salience: number;
  stateKind: RoleStateKind;
}

export const ROLE_META: Record<TelemetryRole, RoleMeta> = {
  pump:          { salience: 3, stateKind: 'binary' },
  valve:         { salience: 3, stateKind: 'binary' },
  dosing:        { salience: 3, stateKind: 'binary' },
  flow:          { unit: 'L/min', salience: 2, stateKind: 'positive' },
  level:         { unit: '%', min: 0, max: 100, salience: 1, stateKind: 'value' },
  pressure:      { unit: 'psi', salience: 1, stateKind: 'value' },
  filter_inlet:  { unit: 'psi', salience: 1, stateKind: 'value' },
  filter_outlet: { unit: 'psi', salience: 1, stateKind: 'value' },
  filter_delta:  { unit: 'psi', salience: 1, stateKind: 'value' },
  flow_total:    { unit: 'L', salience: 0, stateKind: 'value' },
};

/**
 * The published `sensor` id for a node's telemetry channel. Throws on a
 * kind/role mismatch rather than guessing — callers must pass a role the node
 * actually publishes.
 */
export function telemetrySensorId(
  node: Pick<TopologyNode, 'kind' | 'id'>,
  role: TelemetryRole,
): string {
  switch (node.kind) {
    case 'flow_sensor':
      if (role === 'flow') return flowSensorId(node);
      if (role === 'flow_total') return flowTotalId(node);
      break;
    case 'tank':
      if (role === 'level') return pressureSensorLevelId(node);
      break;
    case 'water_source':
      if (role === 'pressure') return waterSourcePressureId(node);
      break;
    case 'pump':
      if (role === 'pump') return pumpSwitchId(node.id);
      break;
    case 'valve':
      if (role === 'valve') return valveCoverId(node);
      break;
    case 'dosing_pump':
      if (role === 'dosing') return dosingPumpSwitchId(node);
      break;
    case 'filter':
      if (role === 'filter_inlet') return filterInletPressureId(node);
      if (role === 'filter_outlet') return filterOutletPressureId(node);
      if (role === 'filter_delta') return filterDeltaPressureId(node);
      break;
  }
  throw new Error(`telemetrySensorId: node kind "${node.kind}" has no telemetry role "${role}"`);
}

// ===========================================================================
// State / fault / reason vocabulary — the canonical tokens a device publishes
// for its categorical channels, plus the meanings the dashboard renders.
//
// We keep the firmware's existing human-readable values; this is the one shared
// place that turns them into meaning. The ordered `*_TOKENS` arrays bridge the
// firmware's internal integer codes to the wire token — index === firmware code,
// so the publisher emits TOKENS[code]. The `*_MEANINGS` maps turn a token into a
// label + a coarse `kind` for badge colour. Defined ONCE: firmware codegen reads
// the arrays, the dashboard reads the maps. An unmapped token is shown as-is, so
// a stale dashboard never breaks — there is no version-pinned decode step.
// ===========================================================================

/** Coarse class of a categorical value, for badge / timeline colour. */
export type StateKind = 'normal' | 'active' | 'warn' | 'fault';

/** What the dashboard shows for a wire token. */
export interface StateMeaning {
  /** Friendly label shown in the UI. */
  label: string;
  /** Colour class. */
  kind: StateKind;
}

/**
 * System state, and per-slot route status, indexed by the firmware's
 * `system_state` / `slots[].state` code (0..4).
 */
export const SYSTEM_STATE_TOKENS = [
  'IDLE', 'PREPARING', 'RUNNING', 'STOPPING', 'FAULT',
] as const;

/** Run origin, indexed by the firmware's `slots[].origin` (0..2). Pairs with an
 *  actor (a user id for MANUAL, an automation index for AUTOMATION) on the
 *  route-origin telemetry channel. */
export const ORIGIN_TOKENS = ['SYSTEM', 'MANUAL', 'AUTOMATION'] as const;
export type OriginToken = (typeof ORIGIN_TOKENS)[number];

/**
 * StopSpec override-mask bit layout — the single TS owner, mirroring
 * `enum OverrideBit` in firmware/components/maji_control/core.h. The Go `command`
 * package and test/override-bits.test.ts pin these against the firmware. Both a
 * scheduled automation's `override_mask` and a manual targeted run's StopSpec are
 * built from these; never hardcode the literals (16/8/…) anywhere else.
 */
export const OVERRIDE_BITS = {
  source_min: 1 << 0,
  dest_max: 1 << 1,
  max_runtime: 1 << 2,
  duration: 1 << 3,
  volume: 1 << 4,
} as const;

/** Fault code, indexed by the firmware's `fault_code` (0..3). */
export const FAULT_TOKENS = [
  'NONE', 'NO_FLOW', 'MAX_RUNTIME', 'CONTROL_LOST',
] as const;

/** Stop reason, indexed by the firmware's `stop_reason` (0..9). APPEND-ONLY: the
 *  index is the wire value, mirrored to enum StopReason in core.h. */
export const STOP_REASON_TOKENS = [
  'NONE', 'MANUAL', 'TANK_FULL', 'NO_FLOW', 'MAX_RUNTIME', 'CONTROL_LOST', 'SOURCE_LOW',
  'VOLUME_REACHED', 'DURATION_REACHED', 'FLOW_STALLED',
] as const;

export type SystemStateToken = (typeof SYSTEM_STATE_TOKENS)[number];
export type FaultToken = (typeof FAULT_TOKENS)[number];
export type StopReasonToken = (typeof STOP_REASON_TOKENS)[number];

export const SYSTEM_STATE_MEANINGS: Record<SystemStateToken, StateMeaning> = {
  IDLE:      { label: 'Idle',      kind: 'normal' },
  PREPARING: { label: 'Preparing', kind: 'active' },
  RUNNING:   { label: 'Running',   kind: 'active' },
  STOPPING:  { label: 'Stopping',  kind: 'active' },
  FAULT:     { label: 'Fault',     kind: 'fault' },
};

export const FAULT_MEANINGS: Record<FaultToken, StateMeaning> = {
  NONE:         { label: 'None',                  kind: 'normal' },
  NO_FLOW:      { label: 'No flow detected',      kind: 'fault' },
  MAX_RUNTIME:  { label: 'Max runtime exceeded',  kind: 'fault' },
  CONTROL_LOST: { label: 'Control link lost',     kind: 'fault' },
};

export const STOP_REASON_MEANINGS: Record<StopReasonToken, StateMeaning> = {
  NONE:             { label: 'None',                  kind: 'normal' },
  MANUAL:           { label: 'Manual stop',           kind: 'normal' },
  TANK_FULL:        { label: 'Tank full',             kind: 'normal' },
  NO_FLOW:          { label: 'No flow detected',      kind: 'warn' },
  MAX_RUNTIME:      { label: 'Max runtime exceeded',  kind: 'warn' },
  CONTROL_LOST:     { label: 'Control link lost',     kind: 'warn' },
  SOURCE_LOW:       { label: 'Source tank low',       kind: 'warn' },
  VOLUME_REACHED:   { label: 'Target volume reached', kind: 'normal' },
  DURATION_REACHED: { label: 'Timed run complete',    kind: 'normal' },
  // Flow confirmed then ceased on a route with no destination tank (an open
  // endpoint that can't be "full"): a clean stop, but flagged as a warning since a
  // flow drop there is loss-of-flow, not a completion. See route-capabilities.ts.
  FLOW_STALLED:     { label: 'Flow stopped',          kind: 'warn' },
};

/**
 * Command outcomes the firmware emits as a transition `to` token when an
 * operator command does not produce a normal state change — it was queued or
 * refused. The specific refusal detail rides in the event `reason` (a
 * STOP_REASON token like SOURCE_LOW/TANK_FULL/CONTROL_LOST, or one of the
 * REJECTED/NOT_ACTIVE/NOT_RUNNING tokens below).
 */
export const OUTCOME_TOKENS = [
  'APPLIED', 'QUEUED', 'REFUSED', 'REJECTED', 'NOT_ACTIVE', 'NOT_RUNNING', 'STALE',
] as const;
export type OutcomeToken = (typeof OUTCOME_TOKENS)[number];

export const OUTCOME_MEANINGS: Record<OutcomeToken, StateMeaning> = {
  APPLIED:     { label: 'Applied',     kind: 'active' },
  QUEUED:      { label: 'Queued',      kind: 'active' },
  REFUSED:     { label: 'Refused',     kind: 'warn' },
  REJECTED:    { label: 'Rejected',    kind: 'warn' },
  NOT_ACTIVE:  { label: 'Not active',  kind: 'normal' },
  NOT_RUNNING: { label: 'Not running', kind: 'normal' },
  STALE:       { label: 'Expired (stale)', kind: 'warn' },
};

/**
 * Firmware route-command results → the transition the device emits. The array
 * INDEX is the integer try_route_start() / try_route_stop() returns (routes.ts),
 * so the MQTT command handler maps rc → {to, reason} by indexing — no
 * hand-decoded magic numbers. rc 0 emits nothing (a started/stopping route logs
 * its own slot edge). Typed against the vocabulary so a wrong token won't compile.
 */
export const ROUTE_START_RESULTS: readonly { to: '' | OutcomeToken; reason: '' | OutcomeToken | StopReasonToken }[] = [
  { to: '',        reason: '' },           // 0 started (and idempotent duplicate)
  { to: 'QUEUED',  reason: '' },           // 1 queued (conflict / no free slot)
  { to: 'REFUSED', reason: 'REJECTED' },   // 2 invalid id / already active / queue full
  { to: 'REFUSED', reason: 'SOURCE_LOW' }, // 3 source tank below its min level
  { to: 'REFUSED', reason: 'TANK_FULL' },  // 4 dest tank above its max level
];

export const ROUTE_STOP_RESULTS: readonly { to: '' | OutcomeToken; reason: '' | OutcomeToken }[] = [
  { to: '',        reason: '' },            // 0 stopping
  { to: 'REFUSED', reason: 'NOT_ACTIVE' },  // 1 route not active
  { to: 'REFUSED', reason: 'NOT_RUNNING' }, // 2 already stopping / idle / faulted
];

/**
 * Manual actuator command (`node_set`) results → the transition the device emits,
 * same shape + index contract as ROUTE_START_RESULTS. The array INDEX is the rc the
 * firmware's manual handler returns: a claim-driven pump run is guarded (dry-run /
 * source-low) like a route, so the refusals reuse the same vocabulary. rc 0 emits
 * APPLIED — an explicit ack the operator's pending toggle reconciles against
 * (unlike a route start, whose slot edge is its own confirmation).
 */
export const NODE_SET_RESULTS: readonly { to: OutcomeToken; reason: '' | OutcomeToken | StopReasonToken }[] = [
  { to: 'APPLIED',  reason: '' },           // 0 claim set / released
  { to: 'REFUSED',  reason: 'SOURCE_LOW' }, // 1 source tank below its min level
  { to: 'REFUSED',  reason: 'NO_FLOW' },    // 2 no local flow sensor → dry-run unprotectable (override to force)
  { to: 'REJECTED', reason: '' },           // 3 no local actuator for this node (e.g. dosing pump)
];

/**
 * Resolve a wire token to its meaning, falling back to the raw token for an
 * unknown value (so a firmware string the dashboard hasn't catalogued yet still
 * renders sensibly, never blank). This is the only decode the dashboard does.
 */
export function describeState(
  meanings: Record<string, StateMeaning>,
  token: string,
): StateMeaning {
  return meanings[token] ?? { label: token, kind: 'normal' };
}

// ---------------------------------------------------------------------------
// Controller snapshot — the ONE JSON body on snapshotTopic(), re-asserted every
// interval. The single source of truth: the server projects it into the latest
// doc, numeric history (rollups), and a derived transition timeline. `site`/
// `controller` come from the topic; `ts` is device-stamped. All token fields are
// typed `string`/union — consumers must tolerate an unrecognised one.
//
// This obeys the soft-state telemetry contract (every field re-asserted each
// interval, survives reboot, fail-safe on silence) — see
// docs/development/architecture.md § "Telemetry & coordination (soft state)".
// ---------------------------------------------------------------------------

/** One route's current run inside a {@link ControllerSnapshot}. */
export interface RouteSnapshot {
  /** Firmware ROUTES[] index (== the dashboard's routeId). */
  id: number;
  /** Current state token (SYSTEM_STATE_TOKENS). */
  state: string;
  /** Who/what started the active run. */
  origin: OriginToken;
  /** Whole id of the actor: a user id (MANUAL), an automation id (AUTOMATION),
   *  '' for SYSTEM/idle. The server resolves it to a display name. */
  actor: string;
  /** Stop/fault reason token explaining the last change, '' when none. */
  reason: string;
  /** Filled server-side at ingest: the actor's display name ("Jane" / "Morning").
   *  Absent on the device wire; present in the stored controller_state doc. */
  actorLabel?: string;
  /** Live run facts, present only while RUNNING — the card-as-progress-bar reads them.
   *  The device reports facts; the app computes the fill + labels (see runProgress). */
  live?: RouteLive;
}

/** A running route's live progress facts (snapshot route `live`). delivered is the
 *  stop-decision basis so the bar hits 100% exactly when the run stops; level progress
 *  uses the dest tank's live level (already on the wire), so it is not duplicated here. */
export interface RouteLive {
  /** Delivered litres so far; -1 if unmetered. */
  del: number;
  /** Elapsed seconds. */
  dur: number;
  /** Target volume L; 0 = none. */
  tv: number;
  /** Target duration s; 0 = none. */
  td: number;
  /** Target level %; -1 = none. */
  tl: number;
}

export interface ControllerSnapshot {
  /** Device-stamped sample time (unix seconds) — one ts for the whole snapshot. */
  ts: number;
  /** Numeric sensor readings keyed by sensor id (telemetrySensorId), incl. health
   *  numerics (heap/uptime/temp/wifi). The server writes these to telemetry_raw. */
  readings: Record<string, number>;
  /** Categorical/text channels keyed by sensor id (reset_reason, ip, queue text…).
   *  Shadow-only; never written to telemetry_raw.
   *
   *  Reserved key `config_version`: the opaque version string of the desired config
   *  the device last applied (the value the server published on configTopic, round-
   *  tripped verbatim — the device never hashes). The server compares it against the
   *  version it currently publishes to drive the desired-vs-applied config reconcile.
   *  Also carries `fw_version` (the running firmware build, for the OTA-release flip). */
  text?: Record<string, string> & { config_version?: string };
  /** System-wide state (the former system_state / queue_depth / safety_override). */
  system: { state: string; queue: number; safety: boolean };
  /** Per-route current run — the source for the dashboard route cards + the
   *  server-derived transition timeline. */
  routes: RouteSnapshot[];
  /** Results of the last few commands the device handled — re-asserted with the
   *  snapshot so a dropped one isn't lost. The server reconciles each matching
   *  `commands` record and surfaces the reason for the command UI. */
  outcomes?: CommandOutcome[];
}

/** Result of a command the device handled (rides in {@link ControllerSnapshot}). */
export interface CommandOutcome {
  command_id: string;
  /** Outcome token (e.g. APPLIED / QUEUED / REFUSED). */
  result: string;
  /** Reason token when refused/queued, '' otherwise. */
  reason: string;
}

export interface StateEvent {
  /** Route id the transition is about, or -1 for a system-wide change. */
  route: number;
  /** Previous state token (SYSTEM_STATE_TOKENS), '' if not applicable. */
  from: string;
  /** New state token (SYSTEM_STATE_TOKENS). */
  to: string;
  /** Stop-reason or fault token explaining the change, '' when none. */
  reason: string;
  /** Correlates to the CommandEnvelope.command_id that triggered it, if any. */
  command_id?: string;
}
