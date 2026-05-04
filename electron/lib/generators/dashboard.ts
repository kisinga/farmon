import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag } from "../schema.js";
import { NODE_REGISTRY, systemHaEntityIds, esphomeServicePrefix } from '@far-mon/core';

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
          { entity: sys.safetyOverride },
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

export function buildSettingsView(m: Manifest): unknown {
  const dev = m.device;
  const sys = systemHaEntityIds(dev, m.routes);
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');

  const calEntities = levelSensors.flatMap(ls => {
    const ids = haIds(ls, dev);
    return [
      { entity: ids.rawVoltage!, name: `${n(ls, 'name')} Raw V` },
      { entity: ids.calEmpty!,   name: `${n(ls, 'name')} Empty` },
      { entity: ids.calFull!,    name: `${n(ls, 'name')} Full` },
    ];
  });

  return {
    title: "Settings",
    path: "settings",
    icon: "mdi:cog",
    cards: [
      { type: "entities", title: "Sensor Calibration (voltage)", entities: calEntities },
      {
        type: "glance", title: "Device Health", show_state: true,
        entities: [
          { entity: sys.batteryPercent,   name: "Battery" },
          { entity: sys.wifiSignal,       name: "WiFi" },
          { entity: sys.esp32Temperature, name: "Temp" },
          { entity: sys.uptime,           name: "Uptime" },
        ],
      },
      ...(flowSensors.length > 0 ? [{
        type: "entities", title: "Sensor Diagnostics",
        entities: flowSensors.map(f => ({ entity: haIds(f, dev).sensorFault!, name: `${n(f, 'name')} Fault` })),
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
