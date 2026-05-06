import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag } from "../schema.js";
import { NODE_REGISTRY, systemHaEntityIds, networkHaEntityIds, batteryHaEntityIds, automationHaEntityId, routeAutomationAlias, type BoardDef } from '@far-mon/core';

// ---------------------------------------------------------------------------
// HA dashboard structural types — keeps generators type-safe without spelling
// out every Lovelace card schema. Producers must always set `type` (the HA
// discriminator); other fields vary per card kind and are checked at the call
// site where they are constructed.
// ---------------------------------------------------------------------------

export type HaWidget = { type: string; [k: string]: unknown };

export interface HaGridSection {
  type: "grid";
  cards: HaWidget[];
  column_span?: number;
}

export interface HaSectionsView {
  title: string;
  icon: string;
  type: "sections";
  subview: boolean;
  sections: HaGridSection[];
  badges: HaWidget[];
  cards: HaWidget[];
}

export interface HaCardsView {
  title: string;
  path: string;
  icon: string;
  cards: HaWidget[];
}

export type HaView = HaSectionsView | HaCardsView;

export interface HaRouteControl {
  sections: HaGridSection[];
}

interface HaDashboard {
  title: string;
  views: HaView[];
}

/** Shorthand for accessing ManifestNode string fields. */
function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

/**
 * Pull a node's HA entity_ids from its entity descriptor. Single source of
 * truth: the descriptor declares both the firmware-emitted name and the
 * derived entity_id, so dashboards can never drift from firmware here.
 */
function haIds(node: ManifestNode, device: { friendly_name: string }): Record<string, string | undefined> {
  return NODE_REGISTRY.get(node.kind)?.codegen?.haEntityIds?.(node, device) ?? {};
}

// ---------------------------------------------------------------------------
// Composable section builders
// ---------------------------------------------------------------------------

export function buildStatusSection(m: Manifest, board: BoardDef): HaGridSection {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const net = networkHaEntityIds(dev, dev.network, board);
  const bat = batteryHaEntityIds(dev, board);

  const healthEntities: Array<{ entity: string; name: string }> = [];
  if (bat) healthEntities.push({ entity: bat.batteryPercent, name: "Battery" });
  if (net) healthEntities.push({ entity: net.wifiSignal,     name: "WiFi" });
  healthEntities.push(
    { entity: sys.esp32Temperature, name: "Temp" },
    { entity: sys.uptime,           name: "Uptime" },
  );

  return {
    type: "grid",
    cards: [
      {
        type: "entities",
        title: "System Status",
        entities: [
          { entity: sys.systemState, name: "State" },
          { entity: sys.activeRoutes, name: "Active Routes" },
          { entity: sys.routeQueue, name: "Queue" },
          { entity: sys.systemFault, name: "Fault" },
          { entity: sys.lastStopReason, name: "Last Stop Reason" },
        ],
        grid_options: { columns: "full" },
      },
      {
        type: "glance", title: "Device Health", show_state: true,
        entities: healthEntities, grid_options: { columns: "full" },
      },
    ],
    column_span: 1,
  };
}

export function buildWaterSection(m: Manifest): HaGridSection {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const waterSources = nodesByKind(m.nodes, 'water_source');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const pressureSensors = nodesByKind(m.nodes, 'pressure_sensor');
  const filters = nodesByKind(m.nodes, 'filter');

  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const levelGauges: HaWidget[] = levelSensors.map(ls => ({
    type: "gauge", entity: haIds(ls, dev).level!, name: n(ls, 'name'),
    min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
  }));

  // Pressure sensors that act as tank-level sources contribute their derived
  // level% to the same row of tank-fill gauges as the level sensors.
  const pressureLevelGauges: HaWidget[] = pressureSensors.map(ps => ({
    type: "gauge", entity: haIds(ps, dev).level!, name: `${n(ps, 'name')} Level`,
    min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
  }));

  const tankLevelGauges: HaWidget[] = [...levelGauges, ...pressureLevelGauges];

  const wsPressureGauges: HaWidget[] = waterSources.filter(ws => ws['pressure_pin']).map(ws => ({
    type: "gauge", entity: haIds(ws, dev).pressure!, name: `${n(ws, 'name')} Pressure`,
    min: 0, max: 10, severity: { red: 0, yellow: 1, green: 2 }, needle: true,
  }));

  const pressureGauges: HaWidget[] = pressureSensors.map(ps => {
    const max = Number(ps['sensor_max_psi'] ?? 15);
    return {
      type: "gauge", entity: haIds(ps, dev).pressure!, name: n(ps, 'name'),
      min: 0, max,
      severity: { red: 0, yellow: max * 0.1, green: max * 0.2 }, needle: true,
    };
  });

  const filterEntities = filters
    .filter(f => f['inlet_pressure_pin'] && f['outlet_pressure_pin'])
    .map(f => ({ entity: haIds(f, dev).deltaPressure!, name: `${n(f, 'name')} ΔP` }));

  const flowColumns: HaWidget[] = flowSensors.map(f => {
    const ids = haIds(f, dev);
    return {
      type: "vertical-stack",
      cards: [
        {
          type: "sensor", entity: ids.flow!,
          name: `${n(f, 'name').replace(" Water Flow", "").replace(" Flow", "")} Flow`,
          graph: "line", hours_to_show: 6,
        },
        {
          type: "statistics-graph", entities: [ids.total!],
          stat_types: ["change"], chart_type: "bar", period: "week", days_to_show: 56,
        },
      ],
    };
  });

  // Section-level Month/Year totals — one row per period instead of all stats
  // in a single row. With N flows, each card gets section-width / N instead
  // of section-width / (2N), which is what truncated labels to "M..." / "Y...".
  const flowLabels = flowSensors.map(f =>
    n(f, 'name').replace(" Water Flow", "").replace(" Flow", "")
  );
  const flowMonthCards: HaWidget[] = flowSensors.map((f, i) => ({
    type: "statistic", entity: haIds(f, dev).total!, stat_type: "change",
    period: { calendar: { period: "month" } }, name: `${flowLabels[i]} Month`,
  }));
  const flowYearCards: HaWidget[] = flowSensors.map((f, i) => ({
    type: "statistic", entity: haIds(f, dev).total!, stat_type: "change",
    period: { calendar: { period: "year" } }, name: `${flowLabels[i]} Year`,
  }));

  const cards: HaWidget[] = [
    { type: "heading", heading: "Water levels", heading_style: "title",
      ...(levelSensors.length >= 2
        ? { badges: [{ type: "entity", show_state: true, show_icon: true, entity: sys.combinedTankLevel }] }
        : {}),
    },
  ];
  if (levelSensors.length >= 2) {
    cards.push({ type: "entities", entities: [{ entity: sys.waterCritical, name: "Water Critical" }], grid_options: { columns: "full" } });
  }
  if (tankLevelGauges.length > 0) {
    cards.push({ type: "horizontal-stack", cards: tankLevelGauges, grid_options: { columns: "full", rows: "auto" } });
  }
  if (wsPressureGauges.length > 0) {
    cards.push({ type: "horizontal-stack", cards: wsPressureGauges, grid_options: { columns: "full", rows: "auto" } });
  }
  if (pressureGauges.length > 0) {
    cards.push({ type: "horizontal-stack", cards: pressureGauges, grid_options: { columns: "full", rows: "auto" } });
  }
  if (filterEntities.length > 0) {
    cards.push({ type: "entities", title: "Filter Status", entities: filterEntities, grid_options: { columns: "full" } });
  }
  if (flowColumns.length > 0) {
    cards.push({ type: "horizontal-stack", cards: flowColumns, grid_options: { columns: "full" } });
  }
  if (flowMonthCards.length > 0) {
    cards.push({ type: "horizontal-stack", cards: flowMonthCards, grid_options: { columns: "full" } });
  }
  if (flowYearCards.length > 0) {
    cards.push({ type: "horizontal-stack", cards: flowYearCards, grid_options: { columns: "full" } });
  }

  return { type: "grid", cards, column_span: 1 };
}

export function buildRouteControlSection(m: Manifest): HaRouteControl {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const valves = nodesByKind(m.nodes, 'valve');
  const dosingPumps = nodesByKind(m.nodes, 'dosing_pump');
  const vfds = nodesByKind(m.nodes, 'vfd');

  const routeColors = ["purple", "deep-purple", "indigo", "blue", "teal", "cyan", "light-blue", "green"];

  // Display-only label: "A > B" → "A → B". Arrow is narrower and reads as
  // direction-of-flow; shaves a couple chars so names fit narrow columns.
  const displayName = (s: string) => s.replace(/\s*>\s*/g, " → ");

  // One column per route — start button on top, stop button below.
  // Replaces two parallel rows of N buttons each, which squeezed labels
  // to <100px on phones.
  const routeButtonColumns: HaWidget[] = m.routes.map((r, i) => ({
    type: "vertical-stack",
    cards: [
      {
        show_name: true, show_icon: true, type: "button", name: displayName(r.name), icon: "mdi:water-sync",
        tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].start } },
        show_state: false, color: routeColors[i % routeColors.length],
      },
      {
        show_name: true, show_icon: true, type: "button", name: "Stop", icon: "mdi:stop-circle-outline",
        tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].stop } },
        show_state: false, color: "red",
      },
    ],
  }));

  const routeStatusEntities = m.routes.map((r, i) => ({ entity: sys.routes[i].status, name: displayName(r.name) }));
  const valveEntities = valves.map((v, i) => ({ entity: haIds(v, dev).cover!, name: `V${i + 1}` }));
  const dosingEntities = dosingPumps.map(dp => ({ entity: haIds(dp, dev).relay!, name: n(dp, 'name') }));
  const vfdEntities = vfds.flatMap(v => {
    const ids = haIds(v, dev);
    const items: Array<{ entity: string; name: string }> = [];
    if (ids.power)         items.push({ entity: ids.power,         name: `${n(v, 'name')} Power` });
    if (ids.frequency)     items.push({ entity: ids.frequency,     name: `${n(v, 'name')} Freq` });
    if (ids.faultCode)     items.push({ entity: ids.faultCode,     name: `${n(v, 'name')} Fault` });
    if (ids.speedSetpoint) items.push({ entity: ids.speedSetpoint, name: `${n(v, 'name')} Speed` });
    if (ids.faultReset)    items.push({ entity: ids.faultReset,    name: `${n(v, 'name')} Reset` });
    return items;
  });

  const mainCards: HaWidget[] = [
    {
      type: "vertical-stack",
      cards: [
        { type: "entities", title: "Route Status", entities: routeStatusEntities, state_color: true, show_header_toggle: false },
        { type: "horizontal-stack", cards: routeButtonColumns },
        {
          type: "horizontal-stack",
          cards: [
            {
              show_name: true, show_icon: true, type: "button", name: "Stop All", icon: "mdi:stop-circle",
              tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.stopAll } },
              show_state: false, color: "red",
            },
            {
              show_name: true, show_icon: true, type: "button", name: "Reset Faults", icon: "mdi:alert-circle-check",
              tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.resetFaults } },
              show_state: false, color: "accent",
            },
            {
              show_name: true, show_icon: true, type: "button", name: "Clear Queue", icon: "mdi:tray-remove",
              tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.clearQueue } },
              show_state: false, color: "grey",
            },
          ],
        },
      ],
      title: "Route Control",
      grid_options: { columns: "full", rows: "auto" },
    },
    {
      type: "glance", title: "Hardware", show_state: true,
      entities: [...valveEntities, ...dosingEntities],
      grid_options: { columns: "full" },
    },
  ];
  if (vfdEntities.length > 0) {
    mainCards.push({ type: "entities", title: "VFD Drive", entities: vfdEntities, grid_options: { columns: "full" } });
  }

  const sections: HaGridSection[] = [
    { type: "grid", cards: mainCards, column_span: 1 },
  ];

  if (m.automations.length > 0) {
    sections.push({
      type: "grid",
      cards: [{
        type: "entities", title: "Automations",
        entities: m.automations.map(a => {
          const alias = routeAutomationAlias(a);
          return { entity: automationHaEntityId(alias), name: alias, icon: "mdi:calendar-clock" };
        }),
        grid_options: { columns: "full" },
      }],
      column_span: 1,
    });
  }

  return { sections };
}

export function buildConfigurationView(m: Manifest): HaCardsView {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const pressureSensors = nodesWithFlag(m.nodes, 'isPressureSensor');
  const valves = nodesWithFlag(m.nodes, 'isValve');

  // Watchdogs / timeouts — global safety timing + per-route max runtime.
  const timingEntities: Array<{ entity: string; name: string }> = [
    { entity: sys.flowWatchdog,   name: "Flow Watchdog" },
    { entity: sys.flowConfirm,    name: "Flow Confirm" },
    { entity: sys.flowThreshold,  name: "Flow Threshold" },
    { entity: sys.apiWatchdog,    name: "API Watchdog" },
    ...m.routes.map((r, i) => ({ entity: sys.routes[i].maxRuntime, name: `${r.name} Max Runtime` })),
  ];

  // Per-route safety thresholds — only emitted when the route's tank endpoint
  // has a level reading (firmware skips emit otherwise; entity_id resolves but
  // no entity exists, so guard with the manifest flag).
  const safetyThresholdEntities: Array<{ entity: string; name: string }> = [];
  m.routes.forEach((r, i) => {
    if (r.source_has_level) {
      safetyThresholdEntities.push({ entity: sys.routes[i].sourceMinLevel, name: `${r.name} Source Min` });
    }
    if (r.dest_has_level) {
      safetyThresholdEntities.push({ entity: sys.routes[i].destMaxLevel, name: `${r.name} Dest Max` });
    }
  });

  // Valve travel times — per-valve, set at commissioning.
  const valveTravelEntities = valves.map(v => ({
    entity: haIds(v, dev).travelTime!, name: `${n(v, 'name')} Travel Time`,
  }));

  // Level sensor calibration (existing pattern).
  const levelCalEntities = levelSensors.flatMap(ls => {
    const ids = haIds(ls, dev);
    return [
      { entity: ids.rawVoltage!, name: `${n(ls, 'name')} Raw V` },
      { entity: ids.calEmpty!,   name: `${n(ls, 'name')} Empty` },
      { entity: ids.calFull!,    name: `${n(ls, 'name')} Full` },
    ];
  });

  // Pressure sensor calibration — sensor electrical range + tank operating range.
  const pressureCalEntities = pressureSensors.flatMap(ps => {
    const ids = haIds(ps, dev);
    return [
      { entity: ids.rangeMin!, name: `${n(ps, 'name')} Sensor Min` },
      { entity: ids.rangeMax!, name: `${n(ps, 'name')} Sensor Max` },
      { entity: ids.calEmpty!, name: `${n(ps, 'name')} Cal Empty` },
      { entity: ids.calFull!,  name: `${n(ps, 'name')} Cal Full` },
    ];
  });

  const cards: HaWidget[] = [
    { type: "entities", title: "Watchdogs & Runtimes", entities: timingEntities },
  ];
  if (safetyThresholdEntities.length > 0) {
    cards.push({ type: "entities", title: "Route Safety Thresholds", entities: safetyThresholdEntities });
  }
  if (valveTravelEntities.length > 0) {
    cards.push({ type: "entities", title: "Valve Travel Times", entities: valveTravelEntities });
  }
  if (levelCalEntities.length > 0) {
    cards.push({ type: "entities", title: "Level Sensor Calibration (voltage)", entities: levelCalEntities });
  }
  if (pressureCalEntities.length > 0) {
    cards.push({ type: "entities", title: "Pressure Sensor Calibration (psi)", entities: pressureCalEntities });
  }

  return {
    title: "Configuration",
    path: "configuration",
    icon: "mdi:cog",
    cards,
  };
}

export function buildManualView(m: Manifest): HaCardsView {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const pumps = nodesByKind(m.nodes, 'pump');
  const valves = nodesWithFlag(m.nodes, 'isValve');

  const explainerCard: HaWidget = {
    type: "markdown",
    content: [
      "**Manual control** — direct access to the pump, valves, and the operator override.",
      "",
      "- **Safety Override**: bypasses pre-start gates (source-low / dest-full), runtime watchdogs (flow, max runtime, API), and lets the pump run without an owning route. Use only for commissioning or recovery.",
      "- **Cover** is the safe way to operate a valve — timer-bounded, used by the routing layer.",
      "- **Open / Close coils** are diagnostic. They bypass the cover's position estimate; firing one during a route can desync state. After firing a coil, call `cover.stop_cover` on the same valve to resync.",
      "- Closing a cover *during* a running route does not stop the route — the flow watchdog will eventually fault it. Use the route Stop button instead.",
    ].join("\n"),
  };

  const overrideCard: HaWidget = {
    type: "entities",
    title: "Operator Override",
    entities: [
      { entity: sys.safetyOverride, name: "Safety Override" },
    ],
  };

  // Pump direct control. Without an owning route, the pump only runs when
  // safety_override is ON (firmware-enforced).
  const pumpEntities = pumps.map(p => ({ entity: haIds(p, dev).relay!, name: n(p, 'name') }));

  // Per-valve manual: cover (timer-bounded), open coil, close coil (raw).
  // Coils are interlocked at firmware level (only one can be ON at a time).
  // show_header_toggle: false suppresses HA's default "master switch" in the
  // card header — for this card a master toggle would try to fire BOTH coils,
  // which the firmware interlock blocks but still results in one coil briefly
  // energizing without timer protection.
  const valveCards: HaWidget[] = valves.map(v => {
    const ids = haIds(v, dev);
    return {
      type: "entities",
      title: n(v, 'name'),
      show_header_toggle: false,
      entities: [
        { entity: ids.cover!,     name: "Cover (timer)" },
        { entity: ids.openCoil!,  name: "Open Coil (raw)" },
        { entity: ids.closeCoil!, name: "Close Coil (raw)" },
      ],
    };
  });

  // Route start/stop buttons — same as Overview, kept here for one-stop manual ops.
  const routeStartButtons: HaWidget[] = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: r.name, icon: "mdi:water-sync",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].start } },
    show_state: false,
  }));
  const routeStopButtons: HaWidget[] = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: `Stop ${r.name}`, icon: "mdi:stop-circle-outline",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].stop } },
    show_state: false, color: "red",
  }));

  // Recovery controls — site-wide stop, fault clearing, queue clearing.
  // Each presses a parameterless template button defined in control.ts.
  const recoveryCard: HaWidget = {
    type: "horizontal-stack",
    cards: [
      {
        show_name: true, show_icon: true, type: "button", name: "Stop All", icon: "mdi:stop-circle",
        tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.stopAll } },
        show_state: false, color: "red",
      },
      {
        show_name: true, show_icon: true, type: "button", name: "Reset Faults", icon: "mdi:alert-circle-check",
        tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.resetFaults } },
        show_state: false, color: "accent",
      },
      {
        show_name: true, show_icon: true, type: "button", name: "Clear Queue", icon: "mdi:tray-remove",
        tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.clearQueue } },
        show_state: false, color: "grey",
      },
    ],
  };

  const cards: HaWidget[] = [explainerCard, overrideCard, recoveryCard];
  if (pumpEntities.length > 0) {
    cards.push({ type: "entities", title: "Pump", entities: pumpEntities });
  }
  cards.push(...valveCards);
  if (m.routes.length > 0) {
    cards.push({
      type: "vertical-stack",
      cards: [
        { type: "horizontal-stack", cards: routeStartButtons },
        { type: "horizontal-stack", cards: routeStopButtons },
      ],
    });
  }

  return {
    title: "Manual",
    path: "manual",
    icon: "mdi:hand-back-right",
    cards,
  };
}

// ---------------------------------------------------------------------------
// Single-system dashboard (convenience wrapper)
// ---------------------------------------------------------------------------

export function generateDashboard(m: Manifest, board: BoardDef): string {
  const routeControl = buildRouteControlSection(m);

  const dashboard: HaDashboard = {
    title: "Water System",
    views: [
      {
        title: "Overview",
        icon: "mdi:water-pump",
        cards: [],
        type: "sections",
        subview: false,
        sections: [
          buildStatusSection(m, board),
          buildWaterSection(m),
          ...routeControl.sections,
        ],
        badges: [],
      },
      buildConfigurationView(m),
      buildManualView(m),
    ],
  };

  return stringify(dashboard, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}
