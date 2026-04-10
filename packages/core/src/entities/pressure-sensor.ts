import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { pressureSensorId } from '../codegen-ids';
import type { FlowConstraint } from '../graph/constraints';

const COLOR = '#8b5cf6'; // violet
const W = 50, H = 36;

// --- Schema ---

export const PressureSensorNodeSchema = z.object({
  kind: z.literal('pressure_sensor'),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,
  min_bar: z.number().default(0),
  max_bar: z.number().default(10),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type PressureSensorNode = z.infer<typeof PressureSensorNodeSchema>;

// --- Descriptor ---

export const pressureSensorDescriptor: NodeDescriptor = {
  kind: 'pressure_sensor',
  label: 'Pressure Sensor',
  isPressureSensor: true,
  conflictClass: 'sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  group: 'sensor',
  schema: PressureSensorNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Pressure ${n}`, pin: '', min_bar: 0, max_bar: 10 }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    // Gauge needle icon
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="M ${cx - 7} ${cy + 5} A 9 9 0 0 1 ${cx + 7} ${cy + 5}" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy + 3}" x2="${cx + 5}" y2="${cy - 6}" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy + 3}" r="2" fill="${COLOR}"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
    { key: 'min_bar', label: 'Min (bar)', type: 'number' },
    { key: 'max_bar', label: 'Max (bar)', type: 'number' },
  ],

  // --- Codegen (native — full support) ---

  codegen: {
    sensors: (node: PressureSensorNode, _idx, ctx) => {
      const sId = pressureSensorId(node);
      const pin = ctx?.resolvePin(node.pin) ?? `number: ${node.pin}`;
      return `\
- platform: adc
  pin:
    ${pin}
  id: ${sId}
  name: "${node.name} Pressure"
  unit_of_measurement: "bar"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  attenuation: 12db
  accuracy_decimals: 2
  filters:
    - median:
        window_size: 5
        send_every: 1
    - sliding_window_moving_average:
        window_size: 5
        send_every: 1
    - calibrate_linear:
        - 0.0 -> ${node.min_bar}
        - 3.3 -> ${node.max_bar}`;
    },

    substitutions: () => [],
  },

  constraints: [
    { type: 'presence', id: 'pressure-upstream-valve', requiredKind: 'valve',
      position: 'upstream', baseSeverity: 'warning',
      description: 'Isolation valve recommended upstream of pressure sensor for maintenance' },
  ] satisfies FlowConstraint[],

  // --- Validation ---

  rules: [{
    id: 'pressure-sensor-pin-required',
    severity: 'error',
    evaluate: (nodes) => nodes
      .filter(n => !n['pin'])
      .map(n => ({
        message: `Pressure sensor "${n['name']}": no pin assigned. Standalone pressure sensors require an ADC pin.`,
        target: String(n['id']),
      })),
  }],
};
