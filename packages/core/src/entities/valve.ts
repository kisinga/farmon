import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { valveCoverId, valveOpenPinId, valveClosePinId, valveTravelMsId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';

const COLOR = '#e11d48'; // rose
const W = 50, H = 36;

// --- Schema (source of truth for ValveNode type) ---

export const ValveNodeSchema = z.object({
  kind: z.literal('valve'),
  id: ComponentId,
  name: z.string().min(1),
  open_pin: GpioPin,
  close_pin: GpioPin,
  travel_time: z.number().gt(1).optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type ValveNode = z.infer<typeof ValveNodeSchema>;

// --- Descriptor ---

export const valveDescriptor: NodeDescriptor = {
  kind: 'valve',
  label: 'Valve',
  isValve: true,
  conflictClass: 'actuator',
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
    { key: 'open_pin', label: 'Open Pin', type: 'pin', placeholder: 'GPIO4', pinCap: 'digital' },
    { key: 'close_pin', label: 'Close Pin', type: 'pin', placeholder: 'GPIO5', pinCap: 'digital' },
    { key: 'travel_time', label: 'Travel Time (s)', type: 'number', placeholder: '15' },
  ],

  // --- Codegen ---

  codegen: {
    hardware: (node: ValveNode, _idx, ctx) => {
      const openId = valveOpenPinId(node);
      const closeId = valveClosePinId(node);
      const openHeader = resolveComponentHeader(ctx, node.open_pin, { purpose: 'digital_out', inverted: true });
      const closeHeader = resolveComponentHeader(ctx, node.close_pin, { purpose: 'digital_out', inverted: true });
      return `\
# --- ${node['name']} ---
${openHeader}
  id: ${openId}
  internal: true
  restore_mode: ALWAYS_OFF
  interlock: [${openId}, ${closeId}]
  interlock_wait_time: 100ms
${closeHeader}
  id: ${closeId}
  internal: true
  restore_mode: ALWAYS_OFF
  interlock: [${openId}, ${closeId}]
  interlock_wait_time: 100ms`;
    },

    extraComponents: (node: ValveNode) => {
      const coverId = valveCoverId(node);
      const openId = valveOpenPinId(node);
      const closeId = valveClosePinId(node);
      const travelId = valveTravelMsId(node);
      return {
        cover: `\
- platform: time_based
  id: ${coverId}
  name: "${node.name}"

  open_action:  [{switch.turn_on: ${openId}}]
  close_action: [{switch.turn_on: ${closeId}}]
  stop_action:  [{switch.turn_off: ${openId}}, {switch.turn_off: ${closeId}}]
  open_duration: \${valve_travel_time}
  close_duration: \${valve_travel_time}`,
        number: `\
- platform: template
  name: "${node.name} Travel Time (ms)"
  id: ${travelId}
  icon: "mdi:timer-cog-outline"
  min_value: 1000
  max_value: 30000
  step: 1000
  initial_value: ${(node.travel_time ?? 15) * 1000}
  optimistic: true
  restore_value: true
  entity_category: config`,
      };
    },

    substitutions: () => [],
  },
};
