import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag } from "../schema.js";
import { NODE_REGISTRY, systemHaEntityIds, networkHaEntityIds, batteryHaEntityIds, esphomeServicePrefix, automationHaEntityId, routeAutomationAlias, type BoardDef } from '@far-mon/core';

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

export function buildStatusSection(m: Manifest): unknown {
  const sys = systemHaEntityIds(m.device, m.routes);
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
    ],
    column_span: 1,
  };
}

export function buildWaterSection(m: Manifest): unknown {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const waterSources = nodesByKind(m.nodes, 'water_source');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const pressureSensors = nodesByKind(m.nodes, 'pressure_sensor');
  const filters = nodesByKind(m.nodes, 'filter');

  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const levelGauges = levelSensors.map(ls => ({
    type: "gauge", entity: haIds(ls, dev).level!, name: n(ls, 'name'),
    min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
  }));

  // Pressure sensors that act as tank-level sources contribute their derived
  // level% to the same row of tank-fill gauges as the level sensors.
  const pressureLevelGauges = pressureSensors.map(ps => ({
    type: "gauge", entity: haIds(ps, dev).level!, name: `${n(ps, 'name')} Level`,
    min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
  }));

  const tankLevelGauges = [...levelGauges, ...pressureLevelGauges];

  const wsPressureGauges = waterSources.filter(ws => ws['pressure_pin']).map(ws => ({
    type: "gauge", entity: haIds(ws, dev).pressure!, name: `${n(ws, 'name')} Pressure`,
    min: 0, max: 10, severity: { red: 0, yellow: 1, green: 2 }, needle: true,
  }));

  const pressureGauges = pressureSensors.map(ps => ({
    type: "gauge", entity: haIds(ps, dev).pressure!, name: n(ps, 'name'),
    min: Number(ps['min_bar'] ?? 0), max: Number(ps['max_bar'] ?? 10),
    severity: { red: 0, yellow: 1, green: 2 }, needle: true,
  }));

  const filterEntities = filters
    .filter(f => f['inlet_pressure_pin'] && f['outlet_pressure_pin'])
    .map(f => ({ entity: haIds(f, dev).deltaPressure!, name: `${n(f, 'name')} ΔP` }));

  const flowColumns = flowSensors.map(f => {
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
        {
          type: "horizontal-stack",
          cards: [
            { type: "statistic", entity: ids.total!, stat_type: "change", period: { calendar: { period: "month" } }, name: "Month" },
            { type: "statistic", entity: ids.total!, stat_type: "change", period: { calendar: { period: "year" } }, name: "Year" },
          ],
        },
      ],
    };
  });

  return {
    type: "grid",
    cards: [
      { type: "heading", heading: "Water levels", heading_style: "title",
        ...(levelSensors.length >= 2
          ? { badges: [{ type: "entity", show_state: true, show_icon: true, entity: sys.combinedTankLevel }] }
          : {}),
      },
      ...(levelSensors.length >= 2
        ? [{ type: "entities", entities: [{ entity: sys.waterCritical, name: "Water Critical" }], grid_options: { columns: "full" } }]
        : []),
      ...(tankLevelGauges.length > 0
        ? [{ type: "horizontal-stack", cards: tankLevelGauges, grid_options: { columns: "full", rows: "auto" } }]
        : []),
      ...(wsPressureGauges.length > 0
        ? [{ type: "horizontal-stack", cards: wsPressureGauges, grid_options: { columns: "full", rows: "auto" } }]
        : []),
      ...(pressureGauges.length > 0
        ? [{ type: "horizontal-stack", cards: pressureGauges, grid_options: { columns: "full", rows: "auto" } }]
        : []),
      ...(filterEntities.length > 0
        ? [{ type: "entities", title: "Filter Status", entities: filterEntities, grid_options: { columns: "full" } }]
        : []),
      ...(flowColumns.length > 0
        ? [{ type: "horizontal-stack", cards: flowColumns, grid_options: { columns: "full" } }]
        : []),
    ],
    column_span: 1,
  };
}

export function buildRouteControlSection(m: Manifest): unknown {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const servicePrefix = esphomeServicePrefix(dev);
  const valves = nodesByKind(m.nodes, 'valve');
  const dosingPumps = nodesByKind(m.nodes, 'dosing_pump');
  const vfds = nodesByKind(m.nodes, 'vfd');

  const routeColors = ["purple", "deep-purple", "indigo", "blue", "teal", "cyan", "light-blue", "green"];

  const routeStartButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: r.name, icon: "mdi:water-sync",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].start } },
    show_state: false, color: routeColors[i % routeColors.length],
  }));

  const routeStopButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: `Stop ${r.name}`, icon: "mdi:stop-circle-outline",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].stop } },
    show_state: false, color: "red",
  }));

  const routeStatusEntities = m.routes.map((r, i) => ({ entity: sys.routes[i].status, name: r.name }));
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

  const automationSection = m.automations.length > 0 ? [{
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
  }] : [];

  return {
    sections: [
      {
        type: "grid",
        cards: [
          {
            type: "vertical-stack",
            cards: [
              { type: "entities", title: "Route Status", entities: routeStatusEntities, state_color: true, show_header_toggle: false },
              { type: "horizontal-stack", cards: routeStartButtons },
              { type: "horizontal-stack", cards: routeStopButtons },
              {
                type: "horizontal-stack",
                cards: [
                  {
                    show_name: true, show_icon: true, type: "button", name: "Stop All", icon: "mdi:stop-circle",
                    tap_action: { action: "call-service", service: `esphome.${servicePrefix}_stop_all` },
                    show_state: false, color: "red",
                  },
                  {
                    show_name: true, show_icon: true, type: "button", name: "Reset Faults", icon: "mdi:alert-circle-check",
                    tap_action: { action: "call-service", service: `esphome.${servicePrefix}_fault_reset_all` },
                    show_state: false, color: "accent",
                  },
                  {
                    show_name: true, show_icon: true, type: "button", name: "Clear Queue", icon: "mdi:tray-remove",
                    tap_action: { action: "call-service", service: `esphome.${servicePrefix}_queue_clear` },
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
          ...(vfdEntities.length > 0
            ? [{ type: "entities", title: "VFD Drive", entities: vfdEntities, grid_options: { columns: "full" } }]
            : []),
        ],
        column_span: 1,
      },
      ...automationSection,
    ],
  };
}

export function buildConfigurationView(m: Manifest, board: BoardDef): unknown {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const net = networkHaEntityIds(dev, dev.network, board);
  const bat = batteryHaEntityIds(dev, board);
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const pressureSensors = nodesWithFlag(m.nodes, 'isPressureSensor');
  const valves = nodesWithFlag(m.nodes, 'isValve');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');

  // Watchdogs / timeouts — global safety timing + per-route max runtime.
  const timingEntities: Array<{ entity: string; name: string }> = [
    { entity: sys.flowWatchdogMs, name: "Flow Watchdog" },
    { entity: sys.flowConfirmMs,  name: "Flow Confirm" },
    { entity: sys.apiWatchdogMs,  name: "API Watchdog" },
    ...m.routes.map((r, i) => ({ entity: sys.routes[i].maxRuntime, name: `${r.name} Max Runtime` })),
  ];

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

  const healthEntities: Array<{ entity: string; name: string }> = [];
  if (bat) healthEntities.push({ entity: bat.batteryPercent, name: "Battery" });
  if (net) healthEntities.push({ entity: net.wifiSignal,     name: "WiFi" });
  healthEntities.push(
    { entity: sys.esp32Temperature, name: "Temp" },
    { entity: sys.uptime,           name: "Uptime" },
  );

  return {
    title: "Configuration",
    path: "configuration",
    icon: "mdi:cog",
    cards: [
      { type: "entities", title: "Watchdogs & Runtimes", entities: timingEntities },
      ...(valveTravelEntities.length > 0 ? [{
        type: "entities", title: "Valve Travel Times", entities: valveTravelEntities,
      }] : []),
      ...(levelCalEntities.length > 0 ? [{
        type: "entities", title: "Level Sensor Calibration (voltage)", entities: levelCalEntities,
      }] : []),
      ...(pressureCalEntities.length > 0 ? [{
        type: "entities", title: "Pressure Sensor Calibration (bar)", entities: pressureCalEntities,
      }] : []),
      { type: "glance", title: "Device Health", show_state: true, entities: healthEntities },
      ...(flowSensors.length > 0 ? [{
        type: "entities", title: "Sensor Diagnostics",
        entities: flowSensors.map(f => ({ entity: haIds(f, dev).sensorFault!, name: `${n(f, 'name')} Fault` })),
      }] : []),
    ],
  };
}

export function buildManualView(m: Manifest): unknown {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const pumps = nodesByKind(m.nodes, 'pump');
  const valves = nodesWithFlag(m.nodes, 'isValve');

  const overrideCard = {
    type: "entities",
    title: "Operator Override",
    entities: [
      { entity: sys.safetyOverride, name: "Safety Override" },
    ],
  };

  // Pump direct control. Without an owning route, the pump only runs when
  // safety_override is ON (firmware-enforced).
  const pumpEntities = pumps.map(p => ({ entity: haIds(p, dev).relay!, name: n(p, 'name') }));
  const pumpCard = pumpEntities.length > 0 ? [{
    type: "entities", title: "Pump", entities: pumpEntities,
  }] : [];

  // Per-valve manual: cover (timer-bounded), open coil, close coil (raw).
  // Coils are interlocked at firmware level (only one can be ON at a time).
  const valveCards = valves.map(v => {
    const ids = haIds(v, dev);
    return {
      type: "entities",
      title: n(v, 'name'),
      entities: [
        { entity: ids.cover!,     name: "Cover (timer)" },
        { entity: ids.openCoil!,  name: "Open Coil (raw)" },
        { entity: ids.closeCoil!, name: "Close Coil (raw)" },
      ],
    };
  });

  // Route start/stop buttons — same as Overview, kept here for one-stop manual ops.
  const routeStartButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: r.name, icon: "mdi:water-sync",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].start } },
    show_state: false,
  }));
  const routeStopButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: `Stop ${r.name}`, icon: "mdi:stop-circle-outline",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: sys.routes[i].stop } },
    show_state: false, color: "red",
  }));
  const routeCard = m.routes.length > 0 ? [{
    type: "vertical-stack",
    cards: [
      { type: "horizontal-stack", cards: routeStartButtons },
      { type: "horizontal-stack", cards: routeStopButtons },
    ],
  }] : [];

  return {
    title: "Manual",
    path: "manual",
    icon: "mdi:hand-back-right",
    cards: [
      overrideCard,
      ...pumpCard,
      ...valveCards,
      ...routeCard,
    ],
  };
}

// ---------------------------------------------------------------------------
// Single-system dashboard (convenience wrapper)
// ---------------------------------------------------------------------------

export function generateDashboard(m: Manifest, board: BoardDef): string {
  const routeControl = buildRouteControlSection(m) as { sections: unknown[] };

  const dashboard = {
    title: "Water System",
    views: [
      {
        title: "Overview",
        icon: "mdi:water-pump",
        cards: [],
        type: "sections",
        subview: false,
        sections: [
          buildStatusSection(m),
          buildWaterSection(m),
          ...routeControl.sections,
        ],
        badges: [],
      },
      buildConfigurationView(m, board),
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
