import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema, RelayPolaritySchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { valveCoverId, valveOpenPinId, valveClosePinId, valveTravelTimeId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields, deriveHaEntityId } from '../ha';
import { templateCoverProxy } from '../remote-proxy';

const COLOR = '#e11d48'; // rose
const W = 50, H = 36;

// --- Schema (source of truth for ValveNode type) ---

export const ValveNodeSchema = z.object({
  kind: z.literal('valve'),
  id: ComponentId,
  name: EntityName,
  open_pin: GpioPin,
  close_pin: GpioPin,
  coil_polarity: RelayPolaritySchema,
  travel_time: z.number().gt(1).default(15),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  anchorId: AnchorIdSchema,
});

export type ValveNode = z.infer<typeof ValveNodeSchema>;

// Single source of truth for valve HA entity names. Both the firmware-emit
// side (codegen.hardware / codegen.extraComponents) and the HA-reference side
// (codegen.haEntityIds) read from this — they cannot drift.
const haNames = (node: ValveNode) => ({
  openCoil:   `${node.name} Open Coil`,
  closeCoil:  `${node.name} Close Coil`,
  cover:      node.name,
  travelTime: `${node.name} Travel Time (s)`,
});

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
  helpUrl: 'docs/installation/power-and-wiring.md',
  schema: ValveNodeSchema,
  haDomain: 'cover',
  defaultHaActions: [
    { id: 'more-info', label: 'More info' },
    { id: 'open', label: 'Open', service: 'cover.open_cover' },
    { id: 'close', label: 'Close', service: 'cover.close_cover' },
    { id: 'stop', label: 'Stop', service: 'cover.stop_cover' },
  ],
  defaultBinds: { label: 'state' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Valve ${n}`, open_pin: '', close_pin: '', coil_polarity: 'active_low', travel_time: 15 }),

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
    { key: 'open_pin', label: 'Open Pin', type: 'pin', placeholder: 'GPIO4', pinCap: 'digital', polarityKey: 'coil_polarity' },
    { key: 'close_pin', label: 'Close Pin', type: 'pin', placeholder: 'GPIO5', pinCap: 'digital', polarityKey: 'coil_polarity' },
    { key: 'coil_polarity', label: 'Coil polarity', type: 'select', options: [
      { value: 'active_low', label: 'Active-low (default)' },
      { value: 'active_high', label: 'Active-high' },
    ] },
    { key: 'travel_time', label: 'Travel Time (s)', type: 'number' },
  ],

  safetyProfile: {
    safetyCritical: false,
    requiredSensors: [],
    deadManTimeoutMs: 0,
    deadManAction: 'hold',
  },

  // --- Codegen ---

  codegen: {
    hardware: (node: ValveNode, _idx, ctx) => {
      const openId = valveOpenPinId(node);
      const closeId = valveClosePinId(node);
      const inverted = node.coil_polarity !== 'active_high';
      const openHeader = resolveComponentHeader(ctx, node.open_pin, { purpose: 'digital_out', inverted });
      const closeHeader = resolveComponentHeader(ctx, node.close_pin, { purpose: 'digital_out', inverted });
      const names = haNames(node);
      return `\
# --- ${node['name']} ---
${openHeader}
  id: ${openId}
  name: "${names.openCoil}"
  restore_mode: ALWAYS_OFF
  interlock: [${openId}, ${closeId}]
  interlock_wait_time: 100ms
${closeHeader}
  id: ${closeId}
  name: "${names.closeCoil}"
  restore_mode: ALWAYS_OFF
  interlock: [${openId}, ${closeId}]
  interlock_wait_time: 100ms`;
    },

    extraComponents: (node: ValveNode) => {
      const coverId = valveCoverId(node);
      const openId = valveOpenPinId(node);
      const closeId = valveClosePinId(node);
      const travelId = valveTravelTimeId(node);
      const names = haNames(node);
      return {
        cover: `\
- platform: time_based
  id: ${coverId}
  name: "${names.cover}"

  open_action:  [{switch.turn_on: ${openId}}]
  close_action: [{switch.turn_on: ${closeId}}]
  stop_action:  [{switch.turn_off: ${openId}}, {switch.turn_off: ${closeId}}]
  open_duration: \${valve_travel_time}
  close_duration: \${valve_travel_time}`,
        number: `\
- platform: template
  name: "${names.travelTime}"
  id: ${travelId}
  icon: "mdi:timer-cog-outline"
  unit_of_measurement: "s"
  min_value: 1
  max_value: 30
  step: 1
  initial_value: ${node.travel_time}
  optimistic: true
  restore_value: true
  entity_category: config`,
      };
    },

    substitutions: () => [],

    haEntityIds: (node: ValveNode, device) => {
      const n = haNames(node);
      return {
        cover:      deriveHaEntityId('cover',  device, n.cover),
        openCoil:   deriveHaEntityId('switch', device, n.openCoil),
        closeCoil:  deriveHaEntityId('switch', device, n.closeCoil),
        travelTime: deriveHaEntityId('number', device, n.travelTime),
      };
    },

    remoteProxy: (node, haEntityId) => ({
      section: 'cover',
      yaml: templateCoverProxy(node.id, node.name, haEntityId),
    }),

  },

  rules: [
    {
      id: 'valve-pin-required',
      severity: 'error',
      evaluate: (nodes) => {
        const out: Array<{ message: string; target?: string }> = [];
        for (const n of nodes) {
          const data = n as Record<string, unknown>;
          if (!data['open_pin']) {
            out.push({
              message: `Valve "${n.name ?? n.id}": Open Pin not configured`,
              target: n.id,
            });
          }
          if (!data['close_pin']) {
            out.push({
              message: `Valve "${n.name ?? n.id}": Close Pin not configured`,
              target: n.id,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'valve-active-high-wiring-hint',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => (n as Record<string, unknown>)['coil_polarity'] === 'active_high')
        .map(n => ({
          message: `Valve "${n.name ?? n.id}": active-high coil polarity selected — verify the relay module's NC contact is wired to the coil, otherwise the coil will be energized at MCU power-off (boot, reset, brown-out).`,
          target: n.id,
        })),
    },
  ],
};
