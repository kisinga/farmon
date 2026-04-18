import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag, slug } from "../schema.js";

function entityId(domain: string, deviceName: string, name: string): string {
  return `${domain}.${slug(deviceName)}_${slug(name)}`;
}

/** Shorthand for accessing ManifestNode string fields. */
function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

// ---------------------------------------------------------------------------
// Entity ID helpers (scoped to a device)
// ---------------------------------------------------------------------------

function deviceEntities(m: Manifest) {
  const dev = m.device.name;
  return {
    levelSensor: (ls: ManifestNode) => entityId("sensor", dev, `${n(ls, 'name')} Level`),
    levelCalEmpty: (ls: ManifestNode) => entityId("number", dev, `${n(ls, 'name')} Cal Empty V`),
    levelCalFull: (ls: ManifestNode) => entityId("number", dev, `${n(ls, 'name')} Cal Full V`),
    levelRawVoltage: (ls: ManifestNode) => entityId("sensor", dev, `${n(ls, 'name')} Raw Voltage`),
    flowSensor: (f: ManifestNode) => entityId("sensor", dev, n(f, 'name')),
    flowTotal: (f: ManifestNode) => {
      const totalName = n(f, 'name').replace("Water Flow", "Total Usage").replace("Flow", "Total");
      return entityId("sensor", dev, totalName);
    },
    flowFault: (f: ManifestNode) => entityId("binary_sensor", dev, `${n(f, 'name')} Sensor Fault`),
    valveCover: (v: ManifestNode) => entityId("cover", dev, n(v, 'name')),
    wsPressureSensor: (ws: ManifestNode) => entityId("sensor", dev, `${n(ws, 'name')} Pressure`),
    pressureSensor: (ps: ManifestNode) => entityId("sensor", dev, `${n(ps, 'name')} Pressure`),
    filterDeltaPressure: (f: ManifestNode) => entityId("sensor", dev, `${n(f, 'name')} Differential Pressure`),
    dosingRelay: (dp: ManifestNode) => entityId("switch", dev, `${n(dp, 'name')} Relay`),
    vfdPower: (v: ManifestNode) => entityId("sensor", dev, `${n(v, 'name')} Power`),
    vfdFrequency: (v: ManifestNode) => entityId("sensor", dev, `${n(v, 'name')} Frequency`),
    vfdFaultCode: (v: ManifestNode) => entityId("sensor", dev, `${n(v, 'name')} Fault Code`),
    vfdSpeedSetpoint: (v: ManifestNode) => entityId("number", dev, `${n(v, 'name')} Speed Setpoint`),
    vfdFaultReset: (v: ManifestNode) => entityId("button", dev, `${n(v, 'name')} Fault Reset`),
    combinedLevel: entityId("sensor", dev, "Combined Tank Level"),
    waterCritical: entityId("binary_sensor", dev, "Water Critical"),
    state: entityId("sensor", dev, "System State"),
    fault: entityId("sensor", dev, "System Fault"),
    stopReason: entityId("sensor", dev, "Last Stop Reason"),
    activeRoutes: entityId("sensor", dev, "Active Routes"),
    queue: entityId("sensor", dev, "Route Queue"),
    safetyOverride: entityId("switch", dev, "Safety Override"),
    batteryPercent: entityId("sensor", dev, "Battery Percent"),
    wifiSignal: entityId("sensor", dev, "WiFi Signal"),
    espTemp: entityId("sensor", dev, "ESP32 Temperature"),
    uptime: entityId("sensor", dev, "Uptime"),
    ipAddress: entityId("sensor", dev, "IP Address"),
    routeStart: (r: typeof m.routes[number], _i: number) => entityId("button", dev, `Start ${r.name}`),
    routeStop: (r: typeof m.routes[number], _i: number) => entityId("button", dev, `Stop ${r.name}`),
    routeStatus: (r: typeof m.routes[number], _i: number) => entityId("sensor", dev, `Route ${r.name}`),
    slug: slug(dev),
  };
}

// ---------------------------------------------------------------------------
// Composable section builders
// ---------------------------------------------------------------------------

export function buildStatusSection(m: Manifest): unknown {
  const e = deviceEntities(m);
  return {
    type: "grid",
    cards: [
      {
        type: "entities",
        title: "System Status",
        entities: [
          { entity: e.state, name: "State" },
          { entity: e.activeRoutes, name: "Active Routes" },
          { entity: e.queue, name: "Queue" },
          { entity: e.fault, name: "Fault" },
          { entity: e.stopReason, name: "Last Stop Reason" },
          { entity: e.safetyOverride },
        ],
        grid_options: { columns: "full" },
      },
    ],
    column_span: 1,
  };
}

export function buildWaterSection(m: Manifest): unknown {
  const e = deviceEntities(m);
  const tanks = nodesByKind(m.nodes, 'tank');
  const waterSources = nodesByKind(m.nodes, 'water_source');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const pressureSensors = nodesByKind(m.nodes, 'pressure_sensor');
  const filters = nodesByKind(m.nodes, 'filter');

  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const levelGauges = levelSensors.map(ls => ({
    type: "gauge", entity: e.levelSensor(ls), name: n(ls, 'name'),
    min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
  }));

  const wsPressureGauges = waterSources.filter(ws => ws['pressure_pin']).map(ws => ({
    type: "gauge", entity: e.wsPressureSensor(ws), name: `${n(ws, 'name')} Pressure`,
    min: 0, max: 10, severity: { red: 0, yellow: 1, green: 2 }, needle: true,
  }));

  const pressureGauges = pressureSensors.map(ps => ({
    type: "gauge", entity: e.pressureSensor(ps), name: n(ps, 'name'),
    min: Number(ps['min_bar'] ?? 0), max: Number(ps['max_bar'] ?? 10),
    severity: { red: 0, yellow: 1, green: 2 }, needle: true,
  }));

  const filterEntities = filters
    .filter(f => f['inlet_pressure_pin'] && f['outlet_pressure_pin'])
    .map(f => ({ entity: e.filterDeltaPressure(f), name: `${n(f, 'name')} ΔP` }));

  const flowColumns = flowSensors.map(f => ({
    type: "vertical-stack",
    cards: [
      {
        type: "sensor", entity: e.flowSensor(f),
        name: `${n(f, 'name').replace(" Water Flow", "").replace(" Flow", "")} Flow`,
        graph: "line", hours_to_show: 6,
      },
      {
        type: "statistics-graph", entities: [e.flowTotal(f)],
        stat_types: ["change"], chart_type: "bar", period: "week", days_to_show: 56,
      },
      {
        type: "horizontal-stack",
        cards: [
          { type: "statistic", entity: e.flowTotal(f), stat_type: "change", period: { calendar: { period: "month" } }, name: "Month" },
          { type: "statistic", entity: e.flowTotal(f), stat_type: "change", period: { calendar: { period: "year" } }, name: "Year" },
        ],
      },
    ],
  }));

  return {
    type: "grid",
    cards: [
      { type: "heading", heading: "Water levels", heading_style: "title",
        ...(levelSensors.length >= 2
          ? { badges: [{ type: "entity", show_state: true, show_icon: true, entity: e.combinedLevel }] }
          : {}),
      },
      ...(levelSensors.length >= 2
        ? [{ type: "entities", entities: [{ entity: e.waterCritical, name: "Water Critical" }], grid_options: { columns: "full" } }]
        : []),
      ...(levelGauges.length > 0
        ? [{ type: "horizontal-stack", cards: levelGauges, grid_options: { columns: "full", rows: "auto" } }]
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
  const e = deviceEntities(m);
  const valves = nodesByKind(m.nodes, 'valve');
  const dosingPumps = nodesByKind(m.nodes, 'dosing_pump');
  const vfds = nodesByKind(m.nodes, 'vfd');

  const routeColors = ["purple", "deep-purple", "indigo", "blue", "teal", "cyan", "light-blue", "green"];

  const routeStartButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: r.name, icon: "mdi:water-sync",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: e.routeStart(r, i) } },
    show_state: false, color: routeColors[i % routeColors.length],
  }));

  const routeStopButtons = m.routes.map((r, i) => ({
    show_name: true, show_icon: true, type: "button", name: `Stop ${r.name}`, icon: "mdi:stop-circle-outline",
    tap_action: { action: "call-service", service: "button.press", target: { entity_id: e.routeStop(r, i) } },
    show_state: false, color: "red",
  }));

  const routeStatusEntities = m.routes.map((r, i) => ({ entity: e.routeStatus(r, i), name: r.name }));
  const valveEntities = valves.map((v, i) => ({ entity: e.valveCover(v), name: `V${i + 1}` }));
  const dosingEntities = dosingPumps.map(dp => ({ entity: e.dosingRelay(dp), name: n(dp, 'name') }));
  const vfdEntities = vfds.flatMap(v => {
    const items: Array<{ entity: string; name: string }> = [];
    if (v['power_register'] != null) items.push({ entity: e.vfdPower(v), name: `${n(v, 'name')} Power` });
    if (v['frequency_register'] != null) items.push({ entity: e.vfdFrequency(v), name: `${n(v, 'name')} Freq` });
    if (v['fault_register'] != null) items.push({ entity: e.vfdFaultCode(v), name: `${n(v, 'name')} Fault` });
    if (v['speed_register'] != null) items.push({ entity: e.vfdSpeedSetpoint(v), name: `${n(v, 'name')} Speed` });
    if (v['fault_reset_register'] != null) items.push({ entity: e.vfdFaultReset(v), name: `${n(v, 'name')} Reset` });
    return items;
  });

  const automationSection = m.automations.length > 0 ? [{
    type: "grid",
    cards: [{
      type: "entities", title: "Automations",
      entities: m.automations.map(a => ({
        entity: `automation.majiflow_${a.id}`, name: `${a.name}: ${a.route_name}`, icon: "mdi:calendar-clock",
      })),
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
                    tap_action: { action: "call-service", service: `esphome.${e.slug}_stop_all` },
                    show_state: false, color: "red",
                  },
                  {
                    show_name: true, show_icon: true, type: "button", name: "Reset Faults", icon: "mdi:alert-circle-check",
                    tap_action: { action: "call-service", service: `esphome.${e.slug}_fault_reset_all` },
                    show_state: false, color: "accent",
                  },
                  {
                    show_name: true, show_icon: true, type: "button", name: "Clear Queue", icon: "mdi:tray-remove",
                    tap_action: { action: "call-service", service: `esphome.${e.slug}_queue_clear` },
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

export function buildSettingsView(m: Manifest): unknown {
  const e = deviceEntities(m);
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');

  const calEntities = levelSensors.flatMap(ls => [
    { entity: e.levelRawVoltage(ls), name: `${n(ls, 'name')} Raw V` },
    { entity: e.levelCalEmpty(ls), name: `${n(ls, 'name')} Empty` },
    { entity: e.levelCalFull(ls), name: `${n(ls, 'name')} Full` },
  ]);

  return {
    title: "Settings",
    path: "settings",
    icon: "mdi:cog",
    cards: [
      { type: "entities", title: "Sensor Calibration (voltage)", entities: calEntities },
      {
        type: "glance", title: "Device Health", show_state: true,
        entities: [
          { entity: e.batteryPercent, name: "Battery" },
          { entity: e.wifiSignal, name: "WiFi" },
          { entity: e.espTemp, name: "Temp" },
          { entity: e.uptime, name: "Uptime" },
        ],
      },
      ...(flowSensors.length > 0 ? [{
        type: "entities", title: "Sensor Diagnostics",
        entities: flowSensors.map(f => ({ entity: e.flowFault(f), name: `${n(f, 'name')} Fault` })),
      }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Single-system dashboard (convenience wrapper)
// ---------------------------------------------------------------------------

export function generateDashboard(m: Manifest): string {
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
      buildSettingsView(m),
    ],
  };

  return stringify(dashboard, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}
