import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#16a34a'; // green
const W = 50, H = 36;

// --- Schema ---

export const FlowSensorNodeSchema = z.object({
  kind: z.literal('flow_sensor'),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,
  flow_cal: z.number().default(450.0),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type FlowSensorNode = z.infer<typeof FlowSensorNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('flow_sensor', {
  kind: 'flow_sensor',
  label: 'Flow Sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  group: 'sensor',
  helpUrl: 'docs/installation-guidelines.md#flow-sensors',
  schema: FlowSensorNodeSchema,
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

  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><circle cx="10" cy="8" r="6" fill="none" stroke="${COLOR}" stroke-width="2"/><circle cx="10" cy="8" r="1.5" fill="${COLOR}"/><path d="M10 8 Q12 5 15 8 Q12 11 10 8 M10 8 Q7 5 7 2 Q11 5 10 8 M10 8 Q7 11 7 14 Q11 11 10 8" fill="${COLOR}" opacity="0.7"/></svg>`,

  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO47', pinCap: 'pulse_counter' },
    { key: 'flow_cal', label: 'Cal (pulses/L)', type: 'number' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node, idx) => `\
  - platform: pulse_counter
    pin:
      number: \${pin_${node['id']}}
      mode: INPUT_PULLUP
    id: ${node['id']}
    name: "${node['name']}"
    unit_of_measurement: "L/min"
    icon: "mdi:water"
    update_interval: \${update_interval}
    filters:
      - lambda: return x / \${flow_cal_${node['id']}};
    on_value:
      - lambda: |-
          const int SENSOR_IDX = ${idx};
          if (id(system_state) == 2 && id(active_route) >= 0 && id(active_route) < NUM_ROUTES) {
            const Route& r = ROUTES[id(active_route)];
            if (r.flow_sensor == SENSOR_IDX) {
              if (x > 0.5f) {
                id(last_flow_time) = millis();
                id(${node['id']}_fault_count) = 0;
                if (!id(flow_confirmed)) {
                  uint32_t elapsed = millis() - id(route_start_time);
                  if (elapsed > (\${flow_confirm_seconds} * 1000U)) {
                    id(flow_confirmed) = true;
                    ESP_LOGI("safety", "Flow confirmed on sensor %d after %us", SENSOR_IDX, elapsed / 1000);
                  }
                }
              } else if (id(flow_confirmed)) {
                id(${node['id']}_fault_count) += 1;
                if (id(${node['id']}_fault_count) == 3) {
                  ESP_LOGW("safety", "Sensor fault detected on ${node['id']} — 3 consecutive zero readings while route running");
                }
              }
            }
          } else if (id(system_state) == 0) {
            id(${node['id']}_fault_count) = 0;
          }

  - platform: integration
    sensor: ${node['id']}
    name: "${(node['name'] as string).replace('Water Flow', 'Total Usage').replace('Flow', 'Total')}"
    id: ${node['id']}_total
    unit_of_measurement: "L"
    time_unit: min
    icon: "mdi:counter"
    state_class: total_increasing`,

    substitutions: (node) => [
      `pin_${node['id']}: "${node['pin']}"`,
      `flow_cal_${node['id']}: "${node['flow_cal']}"`,
    ],

    globals: (node) => `\
  - id: ${node['id']}_fault_count
    type: int
    initial_value: '0'`,
  },
});
