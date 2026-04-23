import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields } from '../ha';

const COLOR = '#16a34a'; // green
const W = 50, H = 36;

// --- Schema ---

export const FlowSensorNodeSchema = z.object({
  kind: z.literal('flow_sensor'),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,
  flow_cal: z.number().default(450.0),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
});

export type FlowSensorNode = z.infer<typeof FlowSensorNodeSchema>;

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
  helpUrl: 'docs/installation-guidelines.md#flow-sensors',
  schema: FlowSensorNodeSchema,
  haDomain: 'sensor',
  defaultHaActions: [{ id: 'more-info', label: 'More info' }],
  defaultBinds: { label: 'state|format:number:1' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Flow ${n}`, pin: '', flow_cal: 450 }),

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
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO47', pinCap: 'pulse_counter' },
    { key: 'flow_cal', label: 'Cal (pulses/L)', type: 'number' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node: FlowSensorNode, idx, ctx) => {
      const sId = flowSensorId(node);
      const totalId = flowTotalId(node);
      const faultId = flowFaultCountId(node);
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'pulse_counter', mode: 'INPUT_PULLUP' });
      return `\
${header}
  id: ${sId}
  name: "${node.name}"
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
          if (x > 0.5f) {
            slots[s].last_flow_time = millis();
            id(${faultId}) = 0;
            if (!slots[s].flow_confirmed) {
              if (millis() - slots[s].run_start_time > (uint32_t)id(flow_confirm_ms).state) {
                slots[s].flow_confirmed = true;
                ESP_LOGI("safety", "Flow confirmed on sensor %d slot %d", SENSOR_IDX, s);
              }
            }
          } else if (slots[s].flow_confirmed) {
            id(${faultId}) += 1;
            if (id(${faultId}) == 3) {
              ESP_LOGW("safety", "Sensor fault on ${node.id} — 3 consecutive zero readings");
            }
          }
          // No break — multiple concurrent routes may share this sensor
        }
        if (derived_system_state() == 0) id(${faultId}) = 0;

- platform: integration
  sensor: ${sId}
  name: "${node.name.replace('Water Flow', 'Total Usage').replace('Flow', 'Total')}"
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
  name: "${node.name} Sensor Fault"
  icon: "mdi:alert-decagram"
  device_class: problem
  entity_category: diagnostic
  lambda: return id(${faultId}) >= 3;`,
      };
    },

    substitutions: (node: FlowSensorNode) => [
      `flow_cal_${node.id}: "${node.flow_cal}"`,
    ],

    globals: (node: FlowSensorNode) => {
      const faultId = flowFaultCountId(node);
      return `\
- id: ${faultId}
  type: int
  initial_value: '0'`;
    },
  },
};
