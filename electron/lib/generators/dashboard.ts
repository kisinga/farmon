import { stringify } from "yaml";
import type { Manifest } from "../schema.js";

// ESPHome entity ID: {domain}.{device_slug}_{name_slug}
// Device name "pump-ctrl" → "pump_ctrl", sensor name "Rain Tank Level" → "rain_tank_level"
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

function entityId(
  domain: string,
  deviceName: string,
  name: string
): string {
  return `${domain}.${slug(deviceName)}_${slug(name)}`;
}

export function generateDashboard(m: Manifest): string {
  const dev = slug(m.device.name);

  // --- Entity ID helpers ---
  const tankSensor = (t: { name: string }) =>
    entityId("sensor", m.device.name, `${t.name} Level`);
  const tankRaw = (t: { name: string }) =>
    entityId("sensor", m.device.name, `${t.name} Raw Voltage`);
  const tankCalEmpty = (t: { name: string }) =>
    entityId("number", m.device.name, `${t.name} Cal Empty V`);
  const tankCalFull = (t: { name: string }) =>
    entityId("number", m.device.name, `${t.name} Cal Full V`);
  const flowSensor = (f: { name: string }) =>
    entityId("sensor", m.device.name, f.name);
  const flowTotal = (f: { name: string }) => {
    const totalName = f.name
      .replace("Water Flow", "Total Usage")
      .replace("Flow", "Total");
    return entityId("sensor", m.device.name, totalName);
  };
  const valveCover = (v: { name: string }) =>
    entityId("cover", m.device.name, v.name);
  const stateSensor = entityId(
    "sensor",
    m.device.name,
    "System State"
  );
  const faultSensor = entityId("sensor", m.device.name, "System Fault");
  const stopReasonSensor = entityId(
    "sensor",
    m.device.name,
    "Last Stop Reason"
  );
  const safetyOverride = entityId(
    "switch",
    m.device.name,
    "Safety Override"
  );

  // --- Water source pressure helpers ---
  const wsPressureSensor = (ws: { name: string }) =>
    entityId("sensor", m.device.name, `${ws.name} Pressure`);

  // --- Water source pressure gauges ---
  const wsPressureGauges = m.water_sources
    .filter((ws) => ws.pressure_pin)
    .map((ws) => ({
      type: "gauge",
      entity: wsPressureSensor(ws),
      name: `${ws.name} Pressure`,
      min: 0,
      max: 10,
      severity: { red: 0, yellow: 1, green: 2 },
      needle: true,
    }));

  // --- Tank gauges ---
  const tankGauges = m.tanks.filter((t) => t.level_pin).map((t) => ({
    type: "gauge",
    entity: tankSensor(t),
    name: t.name,
    min: 0,
    max: 100,
    severity: { red: 0, yellow: 25, green: 50 },
    needle: true,
  }));

  // --- Flow cards (graph + weekly bar + month/year stats) ---
  const flowColumns = m.flow_sensors.map((f) => ({
    type: "vertical-stack",
    cards: [
      {
        type: "sensor",
        entity: flowSensor(f),
        name: `${f.name.replace(" Water Flow", "").replace(" Flow", "")} Flow`,
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

  // --- Route quick-action buttons ---
  const routeColors = [
    "purple",
    "deep-purple",
    "indigo",
    "blue",
    "teal",
    "cyan",
    "light-blue",
    "green",
  ];
  const routeButtons = m.routes.map((r, i) => ({
    show_name: true,
    show_icon: true,
    type: "button",
    name: r.name,
    icon: "mdi:water-sync",
    tap_action: {
      action: "call-service",
      service: `esphome.${dev}_pump_start`,
      data: { route_id: i },
    },
    show_state: false,
    color: routeColors[i % routeColors.length],
  }));

  // --- Valve glance entities ---
  const valveEntities = m.valves.map((v, i) => ({
    entity: valveCover(v),
    name: `V${i + 1}`,
  }));

  // --- Calibration entities ---
  const calEntities = m.tanks.filter((t) => t.level_pin).flatMap((t) => [
    { entity: tankCalEmpty(t), name: `${t.name} Empty` },
    { entity: tankCalFull(t), name: `${t.name} Full` },
  ]);

  // --- Build the YAML structure ---
  // Only ESPHome-derived entities are included. Deployment-specific HA entities
  // (automations, input_selects, scripts, etc.) should be added by the user.
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
          // Section 1: System Status
          {
            type: "grid",
            cards: [
              {
                type: "entities",
                title: "System Status",
                entities: [
                  { entity: stateSensor, name: "Pump State" },
                  { entity: faultSensor, name: "Fault" },
                  { entity: stopReasonSensor, name: "Last Stop Reason" },
                  { entity: safetyOverride },
                ],
                grid_options: { columns: "full" },
              },
            ],
            column_span: 1,
          },
          // Section 2: Water levels + Flow
          {
            type: "grid",
            cards: [
              {
                type: "heading",
                heading: "Water levels",
                heading_style: "title",
              },
              ...(tankGauges.length > 0
                ? [
                    {
                      type: "horizontal-stack",
                      cards: tankGauges,
                      grid_options: { columns: "full", rows: "auto" },
                    },
                  ]
                : []),
              ...(wsPressureGauges.length > 0
                ? [
                    {
                      type: "horizontal-stack",
                      cards: wsPressureGauges,
                      grid_options: { columns: "full", rows: "auto" },
                    },
                  ]
                : []),
              ...(flowColumns.length > 0
                ? [
                    {
                      type: "horizontal-stack",
                      cards: flowColumns,
                      grid_options: { columns: "full" },
                    },
                  ]
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
                  {
                    type: "entities",
                    entities: [
                      { entity: stateSensor, name: "State" },
                      { entity: faultSensor, name: "Fault" },
                    ],
                    state_color: true,
                    show_header_toggle: false,
                  },
                  {
                    type: "horizontal-stack",
                    cards: routeButtons,
                  },
                  {
                    type: "horizontal-stack",
                    cards: [
                      {
                        show_name: true,
                        show_icon: true,
                        type: "button",
                        name: "Stop",
                        icon: "mdi:stop-circle",
                        tap_action: {
                          action: "call-service",
                          service: `esphome.${dev}_pump_stop`,
                        },
                        show_state: false,
                        color: "red",
                      },
                      {
                        show_name: true,
                        show_icon: true,
                        type: "button",
                        name: "Reset Fault",
                        icon: "mdi:alert-circle-check",
                        tap_action: {
                          action: "call-service",
                          service: `esphome.${dev}_fault_reset`,
                        },
                        show_state: false,
                        color: "accent",
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
                entities: valveEntities,
                grid_options: { columns: "full" },
              },
            ],
            column_span: 1,
          },
        ],
        badges: [],
      },
      // Settings view — calibration only (ESPHome-derived)
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
