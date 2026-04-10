import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind } from "../schema.js";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

function entityId(domain: string, deviceName: string, name: string): string {
  return `${domain}.${slug(deviceName)}_${slug(name)}`;
}

/** Shorthand for accessing ManifestNode string fields. */
function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

export function generateDashboard(m: Manifest): string {
  const dev = slug(m.device.name);

  // --- Entity ID helpers ---
  const tankSensor = (t: ManifestNode) => entityId("sensor", m.device.name, `${n(t, 'name')} Level`);
  const tankCalEmpty = (t: ManifestNode) => entityId("number", m.device.name, `${n(t, 'name')} Cal Empty V`);
  const tankCalFull = (t: ManifestNode) => entityId("number", m.device.name, `${n(t, 'name')} Cal Full V`);
  const tankRawVoltage = (t: ManifestNode) => entityId("sensor", m.device.name, `${n(t, 'name')} Raw Voltage`);
  const flowSensor = (f: ManifestNode) => entityId("sensor", m.device.name, n(f, 'name'));
  const flowTotal = (f: ManifestNode) => {
    const totalName = n(f, 'name').replace("Water Flow", "Total Usage").replace("Flow", "Total");
    return entityId("sensor", m.device.name, totalName);
  };
  const flowFault = (f: ManifestNode) => entityId("binary_sensor", m.device.name, `${n(f, 'name')} Sensor Fault`);
  const valveCover = (v: ManifestNode) => entityId("cover", m.device.name, n(v, 'name'));
  const wsPressureSensor = (ws: ManifestNode) => entityId("sensor", m.device.name, `${n(ws, 'name')} Pressure`);
  const pressureSensor = (ps: ManifestNode) => entityId("sensor", m.device.name, `${n(ps, 'name')} Pressure`);
  const filterDeltaPressure = (f: ManifestNode) => entityId("sensor", m.device.name, `${n(f, 'name')} Differential Pressure`);
  const dosingRelay = (dp: ManifestNode) => entityId("switch", m.device.name, `${n(dp, 'name')} Relay`);
  const vfdPower = (v: ManifestNode) => entityId("sensor", m.device.name, `${n(v, 'name')} Power`);
  const vfdFrequency = (v: ManifestNode) => entityId("sensor", m.device.name, `${n(v, 'name')} Frequency`);
  const vfdFaultCode = (v: ManifestNode) => entityId("sensor", m.device.name, `${n(v, 'name')} Fault Code`);
  const vfdSpeedSetpoint = (v: ManifestNode) => entityId("number", m.device.name, `${n(v, 'name')} Speed Setpoint`);
  const vfdFaultReset = (v: ManifestNode) => entityId("button", m.device.name, `${n(v, 'name')} Fault Reset`);

  // System-level entities (derived)
  const combinedLevelSensor = entityId("sensor", m.device.name, "Combined Tank Level");
  const waterCriticalSensor = entityId("binary_sensor", m.device.name, "Water Critical");

  // System-level entities
  const stateSensor = entityId("sensor", m.device.name, "System State");
  const faultSensor = entityId("sensor", m.device.name, "System Fault");
  const stopReasonSensor = entityId("sensor", m.device.name, "Last Stop Reason");
  const activeRoutesSensor = entityId("sensor", m.device.name, "Active Routes");
  const queueSensor = entityId("sensor", m.device.name, "Route Queue");
  const safetyOverride = entityId("switch", m.device.name, "Safety Override");

  // Device health entities
  const batteryPercent = entityId("sensor", m.device.name, "Battery Percent");
  const wifiSignal = entityId("sensor", m.device.name, "WiFi Signal");
  const espTemp = entityId("sensor", m.device.name, "ESP32 Temperature");
  const uptime = entityId("sensor", m.device.name, "Uptime");
  const ipAddress = entityId("sensor", m.device.name, "IP Address");

  // Per-route entities (button + status)
  const routeStartButton = (r: typeof m.routes[number], i: number) =>
    entityId("button", m.device.name, `Start ${r.name}`);
  const routeStopButton = (r: typeof m.routes[number], i: number) =>
    entityId("button", m.device.name, `Stop ${r.name}`);
  const routeStatus = (r: typeof m.routes[number], i: number) =>
    entityId("sensor", m.device.name, `Route ${r.name}`);

  // --- Node lists ---
  const tanks = nodesByKind(m.nodes, 'tank');
  const waterSources = nodesByKind(m.nodes, 'water_source');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const valves = nodesByKind(m.nodes, 'valve');
  const pressureSensors = nodesByKind(m.nodes, 'pressure_sensor');
  const filters = nodesByKind(m.nodes, 'filter');
  const dosingPumps = nodesByKind(m.nodes, 'dosing_pump');
  const vfds = nodesByKind(m.nodes, 'vfd');

  // --- Water source pressure gauges ---
  const wsPressureGauges = waterSources
    .filter((ws) => ws['pressure_pin'])
    .map((ws) => ({
      type: "gauge",
      entity: wsPressureSensor(ws),
      name: `${n(ws, 'name')} Pressure`,
      min: 0,
      max: 10,
      severity: { red: 0, yellow: 1, green: 2 },
      needle: true,
    }));

  // --- Standalone pressure sensor gauges ---
  const pressureGauges = pressureSensors.map((ps) => ({
    type: "gauge",
    entity: pressureSensor(ps),
    name: `${n(ps, 'name')}`,
    min: Number(ps['min_bar'] ?? 0),
    max: Number(ps['max_bar'] ?? 10),
    severity: { red: 0, yellow: 1, green: 2 },
    needle: true,
  }));

  // --- Filter differential pressure entities ---
  const filterEntities = filters
    .filter((f) => f['inlet_pressure_pin'] && f['outlet_pressure_pin'])
    .map((f) => ({
      entity: filterDeltaPressure(f),
      name: `${n(f, 'name')} ΔP`,
    }));

  // --- Tank gauges ---
  const tankGauges = tanks.filter((t) => t['level_pin']).map((t) => ({
    type: "gauge",
    entity: tankSensor(t),
    name: n(t, 'name'),
    min: 0,
    max: 100,
    severity: { red: 0, yellow: 25, green: 50 },
    needle: true,
  }));

  // --- Flow cards ---
  const flowColumns = flowSensors.map((f) => ({
    type: "vertical-stack",
    cards: [
      {
        type: "sensor",
        entity: flowSensor(f),
        name: `${n(f, 'name').replace(" Water Flow", "").replace(" Flow", "")} Flow`,
        graph: "line",
        hours_to_show: 6,
      },
      {
        type: "statistics-graph",
        entities: [flowTotal(f)],
        stat_types: ["change"],
        chart_type: "bar",
        period: "week",
        days_to_show: 56,
      },
      {
        type: "horizontal-stack",
        cards: [
          {
            type: "statistic",
            entity: flowTotal(f),
            stat_type: "change",
            period: { calendar: { period: "month" } },
            name: "Month",
          },
          {
            type: "statistic",
            entity: flowTotal(f),
            stat_type: "change",
            period: { calendar: { period: "year" } },
            name: "Year",
          },
        ],
      },
    ],
  }));

  // --- Per-route start/stop buttons (using button entities) ---
  const routeColors = ["purple", "deep-purple", "indigo", "blue", "teal", "cyan", "light-blue", "green"];
  const routeStartButtons = m.routes.map((r, i) => ({
    show_name: true,
    show_icon: true,
    type: "button",
    name: r.name,
    icon: "mdi:water-sync",
    tap_action: {
      action: "call-service",
      service: "button.press",
      target: { entity_id: routeStartButton(r, i) },
    },
    show_state: false,
    color: routeColors[i % routeColors.length],
  }));

  const routeStopButtons = m.routes.map((r, i) => ({
    show_name: true,
    show_icon: true,
    type: "button",
    name: `Stop ${r.name}`,
    icon: "mdi:stop-circle-outline",
    tap_action: {
      action: "call-service",
      service: "button.press",
      target: { entity_id: routeStopButton(r, i) },
    },
    show_state: false,
    color: "red",
  }));

  // --- Per-route status entities ---
  const routeStatusEntities = m.routes.map((r, i) => ({
    entity: routeStatus(r, i),
    name: r.name,
  }));

  // --- Valve glance entities ---
  const valveEntities = valves.map((v, i) => ({
    entity: valveCover(v),
    name: `V${i + 1}`,
  }));

  // --- Dosing pump entities ---
  const dosingEntities = dosingPumps.map((dp) => ({
    entity: dosingRelay(dp),
    name: n(dp, 'name'),
  }));

  // --- VFD entities ---
  const vfdEntities = vfds.flatMap((v) => {
    const items: Array<{ entity: string; name: string }> = [];
    if (v['power_register'] != null) items.push({ entity: vfdPower(v), name: `${n(v, 'name')} Power` });
    if (v['frequency_register'] != null) items.push({ entity: vfdFrequency(v), name: `${n(v, 'name')} Freq` });
    if (v['fault_register'] != null) items.push({ entity: vfdFaultCode(v), name: `${n(v, 'name')} Fault` });
    if (v['speed_register'] != null) items.push({ entity: vfdSpeedSetpoint(v), name: `${n(v, 'name')} Speed` });
    if (v['fault_reset_register'] != null) items.push({ entity: vfdFaultReset(v), name: `${n(v, 'name')} Reset` });
    return items;
  });

  // --- Calibration entities (with raw voltage) ---
  const calEntities = tanks.filter((t) => t['level_pin']).flatMap((t) => [
    { entity: tankRawVoltage(t), name: `${n(t, 'name')} Raw V` },
    { entity: tankCalEmpty(t), name: `${n(t, 'name')} Empty` },
    { entity: tankCalFull(t), name: `${n(t, 'name')} Full` },
  ]);

  // --- Automation section (conditional) ---
  const automationSection = m.automations.length > 0 ? [{
    type: "grid",
    cards: [
      {
        type: "entities",
        title: "Automations",
        entities: m.automations.map(a => ({
          entity: `automation.majiflow_${a.id}`,
          name: `${a.name}: ${a.route_name}`,
          icon: "mdi:calendar-clock",
        })),
        grid_options: { columns: "full" },
      },
    ],
    column_span: 1,
  }] : [];

  // --- Build the YAML structure ---
  const dashboard = {
    title: "Water System",
    views: [
      {
        title: "Overview",
        icon: "mdi:water-pump",
        cards: [] as unknown[],
        type: "sections",
        subview: false,
        sections: [
          // Section 1: System Status (glance)
          {
            type: "grid",
            cards: [
              {
                type: "entities",
                title: "System Status",
                entities: [
                  { entity: stateSensor, name: "State" },
                  { entity: activeRoutesSensor, name: "Active Routes" },
                  { entity: queueSensor, name: "Queue" },
                  { entity: faultSensor, name: "Fault" },
                  { entity: stopReasonSensor, name: "Last Stop Reason" },
                  { entity: safetyOverride },
                ],
                grid_options: { columns: "full" },
              },
            ],
            column_span: 1,
          },
          // Section 2: Water Levels & Flow
          {
            type: "grid",
            cards: [
              { type: "heading", heading: "Water levels", heading_style: "title",
                ...(tanks.filter(t => t['level_pin']).length >= 2
                  ? { badges: [{ type: "entity", show_state: true, show_icon: true, entity: combinedLevelSensor }] }
                  : {}),
              },
              ...(tanks.filter(t => t['level_pin']).length >= 2
                ? [{ type: "entities", entities: [{ entity: waterCriticalSensor, name: "Water Critical" }], grid_options: { columns: "full" } }]
                : []),
              ...(tankGauges.length > 0
                ? [{ type: "horizontal-stack", cards: tankGauges, grid_options: { columns: "full", rows: "auto" } }]
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
          },
          // Section 3: Route Control
          {
            type: "grid",
            cards: [
              {
                type: "vertical-stack",
                cards: [
                  // Per-route status
                  {
                    type: "entities",
                    title: "Route Status",
                    entities: routeStatusEntities,
                    state_color: true,
                    show_header_toggle: false,
                  },
                  // Start buttons
                  { type: "horizontal-stack", cards: routeStartButtons },
                  // Stop buttons
                  { type: "horizontal-stack", cards: routeStopButtons },
                  // Global actions
                  {
                    type: "horizontal-stack",
                    cards: [
                      {
                        show_name: true, show_icon: true, type: "button",
                        name: "Stop All", icon: "mdi:stop-circle",
                        tap_action: { action: "call-service", service: `esphome.${dev}_stop_all` },
                        show_state: false, color: "red",
                      },
                      {
                        show_name: true, show_icon: true, type: "button",
                        name: "Reset Faults", icon: "mdi:alert-circle-check",
                        tap_action: { action: "call-service", service: `esphome.${dev}_fault_reset_all` },
                        show_state: false, color: "accent",
                      },
                      {
                        show_name: true, show_icon: true, type: "button",
                        name: "Clear Queue", icon: "mdi:tray-remove",
                        tap_action: { action: "call-service", service: `esphome.${dev}_queue_clear` },
                        show_state: false, color: "grey",
                      },
                    ],
                  },
                ],
                title: "Route Control",
                grid_options: { columns: "full", rows: "auto" },
              },
              {
                type: "glance",
                title: "Hardware",
                show_state: true,
                entities: [...valveEntities, ...dosingEntities],
                grid_options: { columns: "full" },
              },
              ...(vfdEntities.length > 0
                ? [{
                    type: "entities",
                    title: "VFD Drive",
                    entities: vfdEntities,
                    grid_options: { columns: "full" },
                  }]
                : []),
            ],
            column_span: 1,
          },
          // Section 4: Automations (conditional)
          ...automationSection,
        ],
        badges: [],
      },
      // Settings tab
      {
        title: "Settings",
        path: "settings",
        icon: "mdi:cog",
        cards: [
          {
            type: "entities",
            title: "Sensor Calibration (voltage)",
            entities: calEntities,
          },
          {
            type: "glance",
            title: "Device Health",
            show_state: true,
            entities: [
              { entity: batteryPercent, name: "Battery" },
              { entity: wifiSignal, name: "WiFi" },
              { entity: espTemp, name: "Temp" },
              { entity: uptime, name: "Uptime" },
            ],
          },
          ...(flowSensors.length > 0 ? [{
            type: "entities",
            title: "Sensor Diagnostics",
            entities: flowSensors.map(f => ({
              entity: flowFault(f),
              name: `${n(f, 'name')} Fault`,
            })),
          }] : []),
        ],
      },
    ],
  };

  return stringify(dashboard, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}
