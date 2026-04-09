import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';

const COLOR = '#e11d48'; // rose
const W = 50, H = 36;

// --- Schema (source of truth for ValveNode type) ---

export const ValveNodeSchema = z.object({
  kind: z.literal('valve'),
  id: ComponentId,
  name: z.string().min(1),
  open_pin: GpioPin,
  close_pin: GpioPin,
  travel_time: z.string().optional(),  // e.g. "15s", "20s" — per-valve override, defaults to global
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type ValveNode = z.infer<typeof ValveNodeSchema>;

// --- Descriptor ---

export const valveDescriptor: NodeDescriptor = {
  kind: 'valve',
  label: 'Valve',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'actuator',
  helpUrl: 'docs/installation-guidelines.md#valves',
  schema: ValveNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Valve ${n}`, open_pin: '', close_pin: '' }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2;
    const hx = 17, hy = 12;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <path d="M ${cx - hx} ${cy - hy} L ${cx} ${cy} L ${cx - hx} ${cy + hy} Z" fill="${COLOR}" fill-opacity="0.15" stroke="${COLOR}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M ${cx + hx} ${cy - hy} L ${cx} ${cy} L ${cx + hx} ${cy + hy} Z" fill="${COLOR}" fill-opacity="0.15" stroke="${COLOR}" stroke-width="2.5" stroke-linejoin="round"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - hy - 2}" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${cx - 6}" y1="${cy - hy - 2}" x2="${cx + 6}" y2="${cy - hy - 2}" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'open_pin', label: 'Open Pin', type: 'pin', placeholder: 'GPIO4' },
    { key: 'close_pin', label: 'Close Pin', type: 'pin', placeholder: 'GPIO5' },
    { key: 'travel_time', label: 'Travel Time', type: 'text', placeholder: '15s' },
  ],

  // --- Codegen ---

  codegen: {
    hardware: (node) => `\
  # --- ${node['name']} ---
  - platform: gpio
    pin:
      number: \${pin_${node['id']}_o}
      inverted: true
    id: ${node['id']}_open_pin
    internal: true
    restore_mode: ALWAYS_OFF
    interlock: [${node['id']}_open_pin, ${node['id']}_close_pin]
    interlock_wait_time: 100ms
  - platform: gpio
    pin:
      number: \${pin_${node['id']}_c}
      inverted: true
    id: ${node['id']}_close_pin
    internal: true
    restore_mode: ALWAYS_OFF
    interlock: [${node['id']}_open_pin, ${node['id']}_close_pin]
    interlock_wait_time: 100ms`,

    substitutions: (node) => [
      `pin_${node['id']}_o: "${node['open_pin']}"`,
      `pin_${node['id']}_c: "${node['close_pin']}"`,
    ],
  },
};
