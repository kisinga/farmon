/**
 * Dashboard chart spec — the neutral, renderer-agnostic description of a site's
 * dashboard, built in the browser from the saved topology.
 *
 * It derives every widget from the SAME `collectTelemetryChannels` enumeration
 * the firmware publishes from, so the dashboard can only ever show channels the
 * device actually emits. The spec carries no ECharts (or any UI library) types —
 * a widget says *what* to show (kind, title, which sensor, unit, meanings), and
 * the UI layer decides *how*. Categorical widgets carry the meanings dictionary
 * so the renderer prettifies wire tokens without decoding them.
 */
import type { SiteTopology } from './topology.types';
import {
  SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR,
  SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS,
  type StateMeaning, type TelemetryRole,
} from './codegen-ids';
import { collectTelemetryChannels, type TelemetryChannel } from './telemetry-channels';
import { topologyToManifestForController } from './topology-to-manifest';

export type WidgetKind = 'gauge' | 'line' | 'stat' | 'badge' | 'timeline' | 'valve' | 'flow';

export interface DashboardWidget {
  /** Stable id: `${controller}/${sensor}`, or `${controller}/timeline`. */
  id: string;
  kind: WidgetKind;
  title: string;
  /** The controller (== device_id == wire `{ctrl}` segment) this widget reads. */
  controller: string;
  /** The wire sensor id the widget reads (absent only for `timeline`). */
  sensor?: string;
  /** For a `flow` widget: the companion cumulative-total sensor, shown beneath
   *  the rate chart in the same card (so rate + total read as one thing). */
  totalSensor?: string;
  unit?: string;
  /** Gauge bounds. */
  min?: number;
  max?: number;
  /** For categorical badges: wire token → meaning (label + colour kind). */
  meanings?: Record<string, StateMeaning>;
}

/** A route an operator can start/stop. `routeId` is the firmware's index into
 *  the controller's route table (`ROUTES[]`), the value sent as `route_id`. The
 *  source/dest/pump/flow fields are presentation hints: they let the dashboard
 *  draw the route as a `source → dest` pipe and bind a live flow readout. */
export interface RouteControl {
  routeId: number;
  name: string;
  /** Friendly name of the source endpoint (tank / water source). */
  source?: string;
  /** Friendly name of the destination endpoint. */
  destination?: string;
  /** True when the route crosses a pump (vs gravity-fed) — drives the glyph. */
  crossesPump?: boolean;
  /** Telemetry sensor id of the route's primary flow sensor, for a live L/min
   *  readout. Undefined for unmonitored routes (no flow sensor). */
  flowSensor?: string;
}

/** An actuator an operator can manually drive via `node_set`. `id` is the
 *  topology node id — the claim key the firmware's dead-man registry uses
 *  (a valve opens / a pump runs while claimed; the lease expiring stops it). */
export interface ActuatorControl {
  id: string;
  name: string;
  kind: 'valve' | 'pump';
  /** The telemetry channel reporting this actuator's actual state (pump relay /
   *  valve cover) — the shadow the dashboard reconciles a manual hold against, so
   *  a toggle reflects reality (latched/refused) instead of staying optimistically on. */
  reportedSensor: string;
}

/** The controllable routes + actuators for one controller. */
export interface ControllerControls {
  controller: string;
  name: string;
  routes: RouteControl[];
  actuators: ActuatorControl[];
}

export interface DashboardSpec {
  widgets: DashboardWidget[];
  controllers: ControllerControls[];
}

interface RolePresentation {
  kind: WidgetKind;
  unit?: string;
  /** Suffix appended to the node name for the widget title (e.g. "Level"). */
  noun?: string;
  min?: number;
  max?: number;
}

/** How each node role is presented. One table, the single role→widget mapping. */
const ROLE_PRESENTATION: Record<TelemetryRole, RolePresentation> = {
  flow:          { kind: 'line',  unit: 'L/min', noun: 'Flow' },
  flow_total:    { kind: 'stat',  unit: 'L',     noun: 'Total' },
  level:         { kind: 'gauge', unit: '%',     noun: 'Level', min: 0, max: 100 },
  pressure:      { kind: 'line',  unit: 'psi',   noun: 'Pressure' },
  pump:          { kind: 'badge' },
  valve:         { kind: 'valve', noun: 'Valve' },
  dosing:        { kind: 'badge' },
  filter_inlet:  { kind: 'line',  unit: 'psi',   noun: 'Inlet' },
  filter_outlet: { kind: 'line',  unit: 'psi',   noun: 'Outlet' },
  filter_delta:  { kind: 'line',  unit: 'psi',   noun: 'Δ Pressure' },
};

/** `${label} ${noun}`, but drop the noun when the name already implies it. */
function composeTitle(label: string, noun?: string): string {
  if (!noun) return label;
  return label.toLowerCase().includes(noun.toLowerCase()) ? label : `${label} ${noun}`;
}

function widgetForChannel(controller: string, ch: TelemetryChannel): DashboardWidget {
  const base = { id: `${controller}/${ch.sensor}`, controller, sensor: ch.sensor };
  const label = ch.label ?? ch.sensor;

  // Categorical enums (system_state, stop_reason) → a badge with its meanings.
  if (ch.kind === 'enum') {
    const meanings =
      ch.sensor === SYSTEM_STATE_SENSOR ? SYSTEM_STATE_MEANINGS :
      ch.sensor === STOP_REASON_SENSOR ? STOP_REASON_MEANINGS :
      undefined;
    return { ...base, kind: 'badge', title: label, meanings };
  }

  // Per-node channels (have a role) → the role presentation table.
  if (ch.role) {
    const p = ROLE_PRESENTATION[ch.role];
    return { ...base, kind: p.kind, title: composeTitle(label, p.noun), unit: p.unit, min: p.min, max: p.max };
  }

  // System-wide numeric/bool channels (queue_depth → stat, safety_override → badge).
  return { ...base, kind: ch.kind === 'bool' ? 'badge' : 'stat', title: label };
}

/**
 * Build the dashboard spec for a whole site: every controller's channels become
 * widgets, plus one activity timeline per controller (fed by `state_events`).
 */
export function buildDashboardSpec(topology: SiteTopology): DashboardSpec {
  const widgets: DashboardWidget[] = [];
  const controllers: ControllerControls[] = [];
  // Friendly endpoint names can span controllers (a route may target a node
  // owned by another controller, e.g. a delivery point), so resolve against the
  // whole topology rather than one controller's manifest.
  const nodeName = new Map(topology.nodes.map((n) => [n.id, n.name || n.id]));
  for (const ctrl of topology.controllers) {
    const manifest = topologyToManifestForController(topology, ctrl.id);
    const channels = collectTelemetryChannels(manifest);
    // A flow sensor emits two channels (rate + cumulative total) for the same
    // node. Merge them into ONE `flow` widget: the rate chart with its total
    // beneath it, instead of two disconnected cards.
    const totalByNode = new Map<string, string>();
    for (const ch of channels) {
      if (ch.role === 'flow_total' && ch.node) totalByNode.set(ch.node, ch.sensor);
    }
    for (const ch of channels) {
      if (ch.role === 'flow_total') continue; // absorbed into the flow widget below
      if (ch.role === 'flow') {
        const base = widgetForChannel(ctrl.id, ch);
        widgets.push({ ...base, kind: 'flow', totalSensor: ch.node ? totalByNode.get(ch.node) : undefined });
        continue;
      }
      widgets.push(widgetForChannel(ctrl.id, ch));
    }
    widgets.push({
      id: `${ctrl.id}/timeline`,
      kind: 'timeline',
      title: 'Activity',
      controller: ctrl.id,
    });
    // Manually drivable actuators: the valve + pump channels this controller
    // publishes. `ch.node` is the topology node id (the node_set claim key) — not
    // ch.sensor, which for a pump is the `<id>_relay` component. Dosing pumps are
    // excluded: they have no owner-side actuation path yet.
    const actuators: ActuatorControl[] = [];
    for (const ch of channels) {
      if ((ch.role === 'valve' || ch.role === 'pump') && ch.node) {
        actuators.push({ id: ch.node, name: ch.label ?? ch.node, kind: ch.role, reportedSensor: ch.sensor });
      }
    }
    // node id → flow telemetry sensor, for a route's live flow readout.
    const flowSensorByNode = new Map<string, string>();
    for (const ch of channels) if (ch.role === 'flow' && ch.node) flowSensorByNode.set(ch.node, ch.sensor);
    controllers.push({
      controller: ctrl.id,
      name: ctrl.friendlyName ?? ctrl.id,
      // Index === firmware route_id (ROUTES[] is built in manifest.routes order).
      routes: manifest.routes.map((r, i) => {
        // The manifest `destination` field is the dest *tank* (for level gating)
        // and is undefined for non-tank endpoints; the real endpoint is the last
        // node in the route's sequence, so use that for the display label.
        const seq = r.nodeSequence ?? [];
        const destId = seq.length ? seq[seq.length - 1] : r.destination;
        return {
          routeId: i,
          name: r.name || r.key,
          source: r.source ? nodeName.get(r.source) ?? r.source : undefined,
          destination: destId ? nodeName.get(destId) ?? destId : undefined,
          crossesPump: r.crossesPump,
          flowSensor: r.flow_sensor ? flowSensorByNode.get(r.flow_sensor) : undefined,
        };
      }),
      actuators,
    });
  }
  return { widgets, controllers };
}
