import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields, deriveHaEntityId } from '../ha';
import { homeassistantSensorImport } from '../remote-proxy';

const COLOR = '#16a34a'; // green
const W = 50, H = 36;

// --- Schema ---

export const FlowSensorNodeSchema = z.object({
  kind: z.literal('flow_sensor'),
  id: ComponentId,
  name: EntityName,
  pin: GpioPin,
  signal_type: z.enum(['pulse', '4_20ma', '0_10v']).default('pulse'),
  flow_cal: z.number().default(450.0),
  max_flow: z.number().default(100.0),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  anchorId: AnchorIdSchema,
});

export type FlowSensorNode = z.infer<typeof FlowSensorNodeSchema>;

// Single source of truth for flow sensor HA entity names. Both firmware emit
// (codegen.sensors / extraComponents) and HA reference (codegen.haEntityIds)
// read from this — including the Water Flow → Total Usage rename rule, which
// previously lived independently in dashboard.ts and drifted from this file.
const haNames = (node: FlowSensorNode) => ({
  flow:        node.name,
  total:       node.name.replace('Water Flow', 'Total Usage').replace('Flow', 'Total'),
  sensorFault: `${node.name} Sensor Fault`,
});

// --- Descriptor ---

export const flowSensorDescriptor: NodeDescriptor = {
  kind: 'flow_sensor',
  label: 'Flow Sensor',
  isFlowSensor: true,
  conflictClass: 'sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  group: 'sensor',
  helpUrl: 'docs/installation/power-and-wiring.md#sensor-cables',
  schema: FlowSensorNodeSchema,
  haDomain: 'sensor',
  defaultHaActions: [{ id: 'more-info', label: 'More info' }],
  defaultBinds: { label: 'state|format:number:1' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Flow ${n}`, pin: '', signal_type: 'pulse', flow_cal: 450, max_flow: 100 }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    const blade = (angle: number) => {
      const rad = (angle * Math.PI) / 180;
      const tip = 10, spread = 4;
      const tx = cx + tip * Math.cos(rad), ty = cy + tip * Math.sin(rad);
      const lx = cx + spread * Math.cos(rad + 1.2), ly = cy + spread * Math.sin(rad + 1.2);
      const rx = cx + spread * Math.cos(rad - 1.2), ry = cy + spread * Math.sin(rad - 1.2);
      return `M ${cx} ${cy} Q ${lx} ${ly} ${tx} ${ty} Q ${rx} ${ry} ${cx} ${cy}`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="${blade(0)} ${blade(120)} ${blade(240)}" fill="${COLOR}" fill-opacity="0.7"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="${COLOR}"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'signal_type', label: 'Signal', type: 'select', options: [
      { value: 'pulse', label: 'Pulse (digital)' },
      { value: '4_20ma', label: '4-20 mA' },
      { value: '0_10v', label: '0-10 V' },
    ]},
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO47', pinCap: 'pulse_counter',
      visibleWhen: { key: 'signal_type', eq: 'pulse' } },
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'AI1', pinCap: 'adc',
      visibleWhen: { key: 'signal_type', in: ['4_20ma', '0_10v'] } },
    { key: 'flow_cal', label: 'Cal (pulses/L)', type: 'number',
      visibleWhen: { key: 'signal_type', eq: 'pulse' } },
    { key: 'max_flow', label: 'Max Flow (L/min)', type: 'number',
      visibleWhen: { key: 'signal_type', in: ['4_20ma', '0_10v'] } },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node: FlowSensorNode, idx, ctx) => {
      const sId = flowSensorId(node);
      const totalId = flowTotalId(node);
      const faultId = flowFaultCountId(node);
      const names = haNames(node);

      if (node.signal_type === 'pulse') {
        const header = resolveComponentHeader(ctx, node.pin, { purpose: 'pulse_counter', mode: 'INPUT_PULLUP' });
        return `\
${header}
  id: ${sId}
  name: "${names.flow}"
  unit_of_measurement: "L/min"
  icon: "mdi:water"
  update_interval: \${update_interval}
  filters:
    - lambda: return x / \${flow_cal_${node['id']}};
  on_value:
    - lambda: |-
        const int SENSOR_IDX = ${idx};
        for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
          if (slots[s].state != 2 || slots[s].route_id < 0) continue;
          if (ROUTES[slots[s].route_id].flow_sensor != SENSOR_IDX) continue;
          if (x >= id(flow_threshold_l_min).state) {
            id(${faultId}) = 0;
          } else if (slots[s].flow_confirmed) {
            id(${faultId}) += 1;
            if (id(${faultId}) == 3) {
              ESP_LOGW("safety", "Sensor fault on ${node.id} — 3 consecutive below-threshold readings");
            }
          }
          // No break — multiple concurrent routes may share this sensor
        }
        if (derived_system_state() == 0) id(${faultId}) = 0;

- platform: integration
  sensor: ${sId}
  name: "${names.total}"
  id: ${totalId}
  unit_of_measurement: "L"
  time_unit: min
  icon: "mdi:counter"
  state_class: total_increasing`;
      }

      // Analog: 4-20mA or 0-10V
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'adc' });
      const is4to20 = node.signal_type === '4_20ma';
      return `\
${header}
  id: ${sId}
  name: "${names.flow}"
  unit_of_measurement: "L/min"
  icon: "mdi:water"
  update_interval: \${update_interval}
  filters:
    - lambda: |-
        float raw = float(x);
        float flow = 0.0f;
        ${is4to20
          ? `if (raw < 4000.0f) return 0.0f;\n        flow = (raw - 4000.0f) / 16000.0f * ${node.max_flow};`
          : `flow = raw / 10000.0f * ${node.max_flow};`
        }
        return flow;
    - sliding_window_moving_average: { window_size: 5, send_every: 1 }
  on_value:
    - lambda: |-
        const int SENSOR_IDX = ${idx};
        for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
          if (slots[s].state != 2 || slots[s].route_id < 0) continue;
          if (ROUTES[slots[s].route_id].flow_sensor != SENSOR_IDX) continue;
          if (x >= id(flow_threshold_l_min).state) {
            id(${faultId}) = 0;
          } else if (slots[s].flow_confirmed) {
            id(${faultId}) += 1;
            if (id(${faultId}) == 3) {
              ESP_LOGW("safety", "Sensor fault on ${node.id} — 3 consecutive below-threshold readings");
            }
          }
        }
        if (derived_system_state() == 0) id(${faultId}) = 0;

- platform: integration
  sensor: ${sId}
  name: "${names.total}"
  id: ${totalId}
  unit_of_measurement: "L"
  time_unit: min
  icon: "mdi:counter"
  state_class: total_increasing`;
    },

    extraComponents: (node: FlowSensorNode) => {
      const faultId = flowFaultCountId(node);
      const faultSensorId = flowFaultSensorId(node);
      return {
        binary_sensor: `\
- platform: template
  id: ${faultSensorId}
  name: "${haNames(node).sensorFault}"
  icon: "mdi:alert-decagram"
  device_class: problem
  entity_category: diagnostic
  lambda: return id(${faultId}) >= 3;`,
      };
    },

    substitutions: (node: FlowSensorNode) => {
      if (node.signal_type === 'pulse') {
        return [`flow_cal_${node.id}: "${node.flow_cal}"`];
      }
      return [`flow_max_${node.id}: "${node.max_flow}"`];
    },

    globals: (node: FlowSensorNode) => {
      const faultId = flowFaultCountId(node);
      return `\
- id: ${faultId}
  type: int
  initial_value: '0'`;
    },

    haEntityIds: (node: FlowSensorNode, device) => {
      const n = haNames(node);
      return {
        flow:        deriveHaEntityId('sensor',        device, n.flow),
        total:       deriveHaEntityId('sensor',        device, n.total),
        sensorFault: deriveHaEntityId('binary_sensor', device, n.sensorFault),
      };
    },

    remoteProxy: (node, haEntityId) => [
      { section: 'sensor', yaml: homeassistantSensorImport(node.id, haEntityId) },
    ],

  },

  rules: [
    {
      id: 'flow-sensor-pin-required',
      severity: 'error',
      evaluate: (nodes) => {
        const out: Array<{ message: string; target?: string }> = [];
        for (const n of nodes) {
          const data = n as Record<string, unknown>;
          if (!data['pin']) {
            out.push({
              message: `Flow sensor "${n.name ?? n.id}": Pin not configured`,
              target: n.id,
            });
          }
        }
        return out;
      },
    },
  ],
};
