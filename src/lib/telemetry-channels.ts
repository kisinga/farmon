/**
 * Telemetry channels — the single enumeration of what a controller publishes.
 *
 * One definition, two consumers:
 *  - the firmware MQTT generator ([codegen/generators/mqtt.ts]) turns each
 *    channel into a publish statement, and
 *  - the dashboard chart spec turns each channel into a widget.
 * Sharing this list guarantees the dashboard only ever shows channels the
 * firmware actually emits — no drift between what is sent and what is read.
 *
 * Each channel mirrors an entity's emit conditions exactly, so we never name an
 * `id()` that the other generators didn't create.
 */
import { type Manifest, type LocalManifestNode } from './manifest.types';
import {
  telemetrySensorId, SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR,
  SYSTEM_STATE_TOKENS, STOP_REASON_TOKENS,
  type TelemetryRole,
} from './codegen-ids';

/**
 * How a channel's value is read/published:
 *  - `state`  reads `id(<sensor>).state`    (numeric sensor; NaN-guarded)
 *  - `bool`   reads `id(<sensor>).state`    (switch; published as 1/0)
 *  - `cover`  reads `id(<sensor>).position` (time_based cover; NaN-guarded)
 *  - `enum`   reads `id(<global>)` (int) and publishes the matching wire token
 *             from `tokens` (index === code), e.g. system_state 2 → "RUNNING"
 *  - `text`   reads `id(<text_sensor>).state` (string) and publishes it verbatim
 *             (server shadows it as a categorical/text value)
 */
export type TelemetryChannelKind = 'state' | 'bool' | 'cover' | 'enum' | 'text';

export interface TelemetryChannel {
  /** The `sensor` segment on the wire — also the ESPHome component id. */
  sensor: string;
  /** The ESPHome id whose value is read (component id, or global name). */
  ref: string;
  kind: TelemetryChannelKind;
  /** For `enum`: wire tokens indexed by the firmware's integer code. */
  tokens?: readonly string[];
  // --- UI metadata (ignored by the firmware generator; used by the chart spec) ---
  /** The node role this channel reports (absent for system-wide channels). */
  role?: TelemetryRole;
  /** The owning node's id (absent for system-wide channels). */
  node?: string;
  /** The owning node's display name (for widget titles). */
  label?: string;
}

/** Per-node telemetry channels, mirroring each entity's emit conditions. */
function collectNodeChannels(m: Manifest): TelemetryChannel[] {
  const channels: TelemetryChannel[] = [];
  const label = (node: LocalManifestNode) => node.name || node.id;
  const chan = (node: LocalManifestNode, role: TelemetryRole, kind: TelemetryChannelKind): TelemetryChannel => {
    const id = telemetrySensorId(node, role);
    return { sensor: id, ref: id, kind, role, node: node.id, label: label(node) };
  };
  const num = (node: LocalManifestNode, role: TelemetryRole) => channels.push(chan(node, role, 'state'));

  for (const node of m.nodes) {
    switch (node.kind) {
      case 'pump':
        channels.push(chan(node, 'pump', 'bool'));
        break;
      case 'dosing_pump':
        channels.push(chan(node, 'dosing', 'bool'));
        break;
      case 'valve':
        channels.push(chan(node, 'valve', 'cover'));
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

/**
 * The full channel list for a controller: system-wide channels first
 * (system_state / stop_reason as enum tokens, queue depth, safety override),
 * then per-node channels. The order is the wire/UI order and must stay stable.
 */
export function collectTelemetryChannels(m: Manifest): TelemetryChannel[] {
  return [
    { sensor: SYSTEM_STATE_SENSOR, ref: 'system_state', kind: 'enum', tokens: SYSTEM_STATE_TOKENS, label: 'System' },
    { sensor: STOP_REASON_SENSOR, ref: 'stop_reason', kind: 'enum', tokens: STOP_REASON_TOKENS, label: 'Last Stop' },
    { sensor: 'queue_depth', ref: 'queue_depth', kind: 'state', label: 'Queue' },
    // Ordered queue contents ("RouteA > RouteB"): the one display state not derivable
    // from the structured channels (queue_depth is only the count). Rides as text.
    { sensor: 'route_queue', ref: 'route_queue_text', kind: 'text', label: 'Queue Order' },
    { sensor: 'safety_override', ref: 'safety_override', kind: 'bool', label: 'Safety Override' },
    ...collectNodeChannels(m),
  ];
}
