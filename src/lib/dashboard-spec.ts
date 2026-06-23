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
  collectConfigSetpoints, ROLE_META,
  type StateMeaning, type TelemetryRole,
} from './codegen-ids';
import { collectTelemetryChannels, type TelemetryChannel } from './telemetry-channels';
import { collectTunableNumbers, type TunableNumber } from './tunable-numbers';
import { getPressureSensorIds } from './pressure-sensor-shared';
import { topologyToManifestForController } from './topology-to-manifest';
import { buildGraph } from './graph/topology-graph';
import { pipesAlongPath } from './graph/highlight';

export type WidgetKind = 'gauge' | 'tank' | 'line' | 'stat' | 'badge' | 'timeline' | 'valve' | 'flow';

export interface DashboardWidget {
  /** Stable id: `${controller}/${sensor}`, or `${controller}/timeline`. */
  id: string;
  kind: WidgetKind;
  title: string;
  /** The controller (== device_id == wire `{ctrl}` segment) this widget reads. */
  controller: string;
  /** The wire sensor id the widget reads (absent only for `timeline`). */
  sensor?: string;
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
  /** The route's path: the ordered node ids it traverses (source→destination) and
   *  the pipe ids between them. Together these are the route's *participants* — the
   *  elements that become "engaged" while it runs, so the map can light the whole
   *  path (nodes + pipes) as one unit. Always set by `buildDashboardSpec`; optional
   *  so non-spec literals stay valid. */
  pathNodeIds?: string[];
  pipeIds?: string[];
}

/** Human identity for a route, harmonised across every consumer that names one
 *  (route cards, the activity timeline, …) so they never disagree: its
 *  `source → destination` when both endpoints are known, else its name/key, else
 *  the positional id. Pure — compose with {@link findRoute} to resolve from a spec. */
export function routeLabel(route: RouteControl | undefined, routeId: number): string {
  if (route?.source && route?.destination) return `${route.source} → ${route.destination}`;
  return route?.name || `route ${routeId}`;
}

/** Look up a controller's route control in a built {@link DashboardSpec}, by the
 *  firmware route id. Pairs with {@link routeLabel} to name a route from just an
 *  `(controller, routeId)` — the form events/commands carry. */
export function findRoute(
  spec: DashboardSpec,
  controller: string,
  routeId: number,
): RouteControl | undefined {
  return spec.controllers
    .find((c) => c.controller === controller)
    ?.routes.find((r) => r.routeId === routeId);
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

/** A runtime-tunable route setpoint an operator can edit via `config_set`. `key`
 *  is the device's `number:` id — also the config_set key AND the telemetry sensor
 *  the live value publishes under, so the editor reads the current value from the
 *  shadow and writes back to the same name. `default` is the topology-baked
 *  fallback the firmware uses when the override is unset. */
export interface SetpointControl {
  key: string;
  routeId: number;
  routeName: string;
  field: 'source_min_pct' | 'dest_max_pct';
  /** Short editor label, e.g. "Source min" / "Dest max". */
  label: string;
  /** Topology-baked default — shown as the input placeholder. */
  default: number;
  min: number;
  max: number;
  unit: string;
}

/** A level-monitored tank's pressure-sensor calibration, presented to the operator
 *  in physical terms. The physical fields are the saved topology's design inputs —
 *  a *lens* the editor seeds from and translates to the device's psi anchors via
 *  `deriveTankCalibration` (and back via `tankCalibrationToPhysical`); the dashboard
 *  never writes them back to topology. The editor writes the psi `*Key` numbers via
 *  config_set and reads the live values (device cal + level %) from the shadow. */
export interface CalibrationControl {
  nodeId: string;
  nodeName: string;
  /** Design inputs (topology): tank height, sensor drop below tank, sensor full-scale. */
  tankHeightM: number;
  sensorDropM: number;
  sensorMaxPsi: number;
  /** Device `number:` ids written via config_set (the two field-cal anchors). */
  calEmptyKey: string;
  calFullKey: string;
  /** Live telemetry ids: level % (published) and raw pressure (published only if
   *  the raw sensor channel is emitted). */
  levelSensor: string;
  pressureSensor: string;
}

/** The controllable routes + actuators + schedules for one controller. */
export interface ControllerControls {
  controller: string;
  name: string;
  routes: RouteControl[];
  actuators: ActuatorControl[];
  /** The controller's full telemetry enumeration — the node↔sensor↔role binding
   *  `collectTelemetryChannels` produces. Carried (not discarded) so node-centric
   *  consumers — the live map's runtime projection — read the SAME source the
   *  widgets/actuators derive from, instead of re-joining node→sensor→shadow. */
  channels: TelemetryChannel[];
  /** Per-route tank-% setpoints, live-tunable via config_set. */
  setpoints: SetpointControl[];
  /** Every runtime-tunable device number (timings, runtime, setpoints,
   *  calibration), for the operator-mode editors. `setpoints` above is the
   *  per-route level subset (also surfaced by the Tuning editor). */
  tunables: TunableNumber[];
  /** Per level-monitored tank pressure-sensor calibration (physical-model editor). */
  calibrations: CalibrationControl[];
}

export interface DashboardSpec {
  widgets: DashboardWidget[];
  controllers: ControllerControls[];
}

interface RolePresentation {
  kind: WidgetKind;
  /** Suffix appended to the node name for the widget title (e.g. "Level"). */
  noun?: string;
}

/** How each node role maps to a WIDGET. Unit/range are NOT here — they're domain
 *  facts read from `ROLE_META`; this table is the view-only kind/noun mapping. */
const ROLE_PRESENTATION: Record<TelemetryRole, RolePresentation> = {
  flow:          { kind: 'line',  noun: 'Flow' },
  flow_total:    { kind: 'stat',  noun: 'Total' },
  level:         { kind: 'tank',  noun: 'Level' },
  pressure:      { kind: 'line',  noun: 'Pressure' },
  pump:          { kind: 'badge' },
  valve:         { kind: 'valve', noun: 'Valve' },
  dosing:        { kind: 'badge' },
  filter_inlet:  { kind: 'line',  noun: 'Inlet' },
  filter_outlet: { kind: 'line',  noun: 'Outlet' },
  filter_delta:  { kind: 'line',  noun: 'Δ Pressure' },
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

  // Free-text channel (e.g. ordered queue contents) → a badge showing the raw
  // string verbatim (no meanings dictionary; the renderer displays the value).
  if (ch.kind === 'text') {
    return { ...base, kind: 'badge', title: label };
  }

  // Per-node channels (have a role): widget kind/noun from ROLE_PRESENTATION,
  // unit/range from the role's semantic profile (ROLE_META).
  if (ch.role) {
    const p = ROLE_PRESENTATION[ch.role];
    const m = ROLE_META[ch.role];
    return { ...base, kind: p.kind, title: composeTitle(label, p.noun), unit: m.unit, min: m.min, max: m.max };
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
  // One graph for the whole site, to trace each route's pipes along its exact path.
  const tg = buildGraph(topology.nodes, topology.pipes);
  for (const ctrl of topology.controllers) {
    const manifest = topologyToManifestForController(topology, ctrl.id);
    const channels = collectTelemetryChannels(manifest);
    // A flow sensor emits two channels (rate + cumulative total). The card shows
    // a `flow` widget — the rate chart, with windowed usage integrated from that
    // rate — so the device's cumulative-total channel is dropped here.
    for (const ch of channels) {
      if (ch.role === 'flow_total') continue; // usage is integrated from the rate
      if (ch.role === 'flow') {
        widgets.push({ ...widgetForChannel(ctrl.id, ch), kind: 'flow' });
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
        // This route's pipes = the pipes along its exact node path. Parallel routes
        // between the same endpoints (different valves) stay distinct — endpoint
        // reachability would conflate them and light up the wrong branch.
        const pipeIds = pipesAlongPath(tg, seq);
        return {
          routeId: i,
          name: r.name || r.key,
          source: r.source ? nodeName.get(r.source) ?? r.source : undefined,
          destination: destId ? nodeName.get(destId) ?? destId : undefined,
          crossesPump: r.crossesPump,
          flowSensor: r.flow_sensor ? flowSensorByNode.get(r.flow_sensor) : undefined,
          pathNodeIds: seq,
          pipeIds,
        };
      }),
      actuators,
      channels,
      // Per-route tank-% setpoints, live-tunable via config_set. Gated on the
      // same source/dest level flags the firmware emits the number entities under.
      setpoints: collectConfigSetpoints(manifest.routes).map((sp) => {
        const r = manifest.routes[sp.routeId];
        const isSource = sp.field === 'source_min_pct';
        return {
          key: sp.key,
          routeId: sp.routeId,
          routeName: r?.name || r?.key || `Route ${sp.routeId}`,
          field: sp.field,
          label: isSource ? 'Source min' : 'Dest max',
          default: (isSource ? r?.source_min_pct : r?.dest_max_pct) ?? 0,
          min: 0,
          max: 100,
          unit: '%',
        };
      }),
      // Every runtime-tunable number this controller exposes (operator-mode editors).
      tunables: collectTunableNumbers(manifest),
      // Per level-monitored tank: physical-model calibration (same emit condition as
      // the cal numbers — pressure_pin + sensor_max_psi set).
      calibrations: manifest.nodes
        .filter((node) => node.kind === 'tank' && node['pressure_pin'] && typeof node['pressure_sensor_max_psi'] === 'number')
        .map((node) => {
          const ids = getPressureSensorIds({ id: node.id });
          return {
            nodeId: node.id,
            nodeName: node.name,
            tankHeightM: (node['height_m'] as number | undefined) ?? 0,
            sensorDropM: (node['pressure_elevation_m'] as number | undefined) ?? 0,
            sensorMaxPsi: node['pressure_sensor_max_psi'] as number,
            calEmptyKey: ids.calEmpty,
            calFullKey: ids.calFull,
            levelSensor: ids.levelId,
            pressureSensor: ids.sId,
          };
        }),
    });
  }
  return { widgets, controllers };
}
