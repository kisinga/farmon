import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { SYMBOL } from '../symbol-style';
import { flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { udpSensorImport } from '../remote-proxy';

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
  anchorId: AnchorIdSchema,
});

export type FlowSensorNode = z.infer<typeof FlowSensorNodeSchema>;

// Single source of truth for the flow sensor's emitted entity names, read by
// the firmware-emit side (codegen.sensors / extraComponents) — including the
// Water Flow → Total Usage rename rule.
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
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Flow ${n}`, pin: '', signal_type: 'pulse', flow_cal: 450, max_flow: 100 }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    // Blades drawn around the ORIGIN; the outer group translates them onto the
    // body centre. Same pattern as the pump impeller: an inner `data-part=spin`
    // with no transform of its own, so the shared `[data-part=spin]` rule
    // (fill-box + center) rotates it cleanly in place. An EVEN blade count keeps
    // the group's bbox 2-fold-symmetric, so its centre is the true hub — a 3-fold
    // wheel's bbox is off-centre and would wobble.
    const blade = (angle: number) => {
      const rad = (angle * Math.PI) / 180;
      const tip = 10, spread = 4;
      const tx = (tip * Math.cos(rad)).toFixed(2), ty = (tip * Math.sin(rad)).toFixed(2);
      const lx = (spread * Math.cos(rad + 1.2)).toFixed(2), ly = (spread * Math.sin(rad + 1.2)).toFixed(2);
      const rx = (spread * Math.cos(rad - 1.2)).toFixed(2), ry = (spread * Math.sin(rad - 1.2)).toFixed(2);
      return `M 0 0 Q ${lx} ${ly} ${tx} ${ty} Q ${rx} ${ry} 0 0`;
    };
    // Body takes the state accent; the paddle wheel turns while flowing. The
    // L/min label is overlaid by the canvas (live.value).
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle data-part="body" cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="${SYMBOL.stroke}"/>
      <g transform="translate(${cx},${cy})"><g data-part="spin">
        <path d="${blade(0)} ${blade(90)} ${blade(180)} ${blade(270)}" fill="${COLOR}" fill-opacity="0.7"/>
        <circle r="2.5" fill="${COLOR}"/>
      </g></g>
    </svg>`;
  },

  // Live map: paddle wheel spins while flowing (value>0 → state-on); L/min readout.
  live: { spin: true, value: true },

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
        auto &cs = id(control).state();
        for (int s = 0; s < maji_ctl::MAX_CONCURRENT_ROUTES; s++) {
          if (cs.slots[s].state != 2 || cs.slots[s].route_id < 0) continue;
          if (cs.routes[cs.slots[s].route_id].flow_sensor != SENSOR_IDX) continue;
          if (x >= id(flow_threshold_l_min).state) {
            id(${faultId}) = 0;
          } else if (cs.slots[s].flow_confirmed) {
            id(${faultId}) += 1;
            if (id(${faultId}) == 3) {
              ESP_LOGW("safety", "Sensor fault on ${node.id} — 3 consecutive below-threshold readings");
            }
          }
          // No break — multiple concurrent routes may share this sensor
        }
        if (maji_ctl::derived_system_state(cs) == 0) id(${faultId}) = 0;

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
        auto &cs = id(control).state();
        for (int s = 0; s < maji_ctl::MAX_CONCURRENT_ROUTES; s++) {
          if (cs.slots[s].state != 2 || cs.slots[s].route_id < 0) continue;
          if (cs.routes[cs.slots[s].route_id].flow_sensor != SENSOR_IDX) continue;
          if (x >= id(flow_threshold_l_min).state) {
            id(${faultId}) = 0;
          } else if (cs.slots[s].flow_confirmed) {
            id(${faultId}) += 1;
            if (id(${faultId}) == 3) {
              ESP_LOGW("safety", "Sensor fault on ${node.id} — 3 consecutive below-threshold readings");
            }
          }
        }
        if (maji_ctl::derived_system_state(cs) == 0) id(${faultId}) = 0;

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

    remoteProxy: (node) => [
      { section: 'sensor', yaml: udpSensorImport(node.id) },
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
