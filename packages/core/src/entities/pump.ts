import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema, RelayPolaritySchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { pumpSwitchId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields, deriveHaEntityId } from '../ha';

const COLOR = '#dc2626'; // red
const S = 60;

// --- Schema ---

export const PumpNodeSchema = z.object({
  kind: z.literal('pump'),
  id: ComponentId,
  name: EntityName.default('Pump'),
  pin: GpioPin,
  relay_polarity: RelayPolaritySchema,
  disabled: z.boolean().optional(),
  ports: z
    .array(PortSchema)
    .length(2)
    .refine(
      (ports) =>
        ports.filter((p) => p.direction === 'inlet').length === 1 &&
        ports.filter((p) => p.direction === 'outlet').length === 1,
      { message: 'Pump must have exactly one inlet and one outlet port' },
    ),
  position: PositionSchema,
  ...HaNodeFields,
});

export type PumpNode = z.infer<typeof PumpNodeSchema>;

// Single source of truth for pump HA entity names. Both the firmware-emit
// side (codegen.hardware) and the HA-reference side (codegen.haEntityIds)
// read from this — they cannot drift.
const haNames = (_node: PumpNode) => ({
  relay: 'Pump Relay',
});

// --- Descriptor ---

export const pumpDescriptor: NodeDescriptor = {
  kind: 'pump',
  label: 'Pump',
  isPump: true,
  conflictClass: 'actuator',
  color: COLOR,
  size: { width: S, height: S },
  role: 'passthrough',
  category: 'actuator',
  group: 'pump',
  schema: PumpNodeSchema,
  haDomain: 'switch',
  defaultHaActions: [
    { id: 'more-info', label: 'More info' },
    { id: 'toggle', label: 'Toggle', service: 'switch.toggle' },
  ],
  defaultBinds: { label: 'state' },
  defaultPorts: [
    { id: 'in', label: 'Inlet', direction: 'inlet' },
    { id: 'out', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: () => ({ name: 'Pump', pin: '', relay_polarity: 'active_low' }),

  renderSvg: (_data) => {
    const cx = S / 2, cy = S / 2, r = S / 2 - 5;
    const v = r - 4; // vane reach
    // Curved impeller vanes: each vane arcs from center outward (backward-curved, like a real centrifugal impeller)
    const vanes = [0, 60, 120, 180, 240, 300].map(deg => {
      const rad = deg * Math.PI / 180;
      const ex = Math.round(Math.cos(rad) * v);
      const ey = Math.round(Math.sin(rad) * v);
      // Control point offset perpendicular (clockwise) for backward curve
      const cpRad = rad + Math.PI / 3;
      const cpx = Math.round(Math.cos(cpRad) * v * 0.55);
      const cpy = Math.round(Math.sin(cpRad) * v * 0.55);
      return `<path d="M 0 0 Q ${cpx} ${cpy} ${ex} ${ey}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <line x1="${cx + r}" y1="${cy}" x2="${S}" y2="${cy}" stroke="${COLOR}" stroke-width="3" stroke-linecap="round"/>
      <line x1="0" y1="${cy}" x2="${cx - r}" y2="${cy}" stroke="${COLOR}" stroke-width="3" stroke-linecap="round"/>
      <g transform="translate(${cx},${cy})">${vanes}<circle r="3" fill="${COLOR}"/></g>
    </svg>`;
  },

  sidebarFields: [
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42', pinCap: 'digital', polarityKey: 'relay_polarity' },
    { key: 'relay_polarity', label: 'Relay polarity', type: 'select', options: [
      { value: 'active_low', label: 'Active-low (default)' },
      { value: 'active_high', label: 'Active-high' },
    ] },
  ],

  constraints: [
    { type: 'presence', id: 'pump-inlet-valve', requiredKind: ['valve'],
      position: 'upstream', baseSeverity: 'error',
      description: 'Isolation valve required before pump inlet' },
    { type: 'presence', id: 'pump-downstream-flow', requiredKind: ['flow_sensor'],
      position: 'downstream', baseSeverity: 'warning',
      description: 'Flow sensor recommended downstream for dry-run protection' },
    { type: 'ordering', id: 'pump-outlet-ordering', segment: 'downstream',
      firstKind: 'valve', secondKind: 'flow_sensor', baseSeverity: 'error',
      description: 'Outlet valve must precede flow sensor for isolation' },
  ] satisfies FlowConstraint[],

  // --- Codegen ---

  codegen: {
    hardware: (node: PumpNode, _idx, ctx) => {
      const id = pumpSwitchId();
      const inverted = node.relay_polarity !== 'active_high';
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'digital_out', inverted });
      return `\
# --- Pump relay ------------------------------------------------------------
${header}
  id: ${id}
  name: "${haNames(node).relay}"
  icon: "mdi:water-pump"
  restore_mode: ALWAYS_OFF
  on_turn_on:
    - if:
        condition:
          lambda: 'return pump_ref_count() == 0 && !id(safety_override).state;'
        then:
          - switch.turn_off: ${id}
          - logger.log: {level: WARN, format: "BLOCKED: pump only runs during a route or when safety_override is ON"}`;
    },

    substitutions: () => [],

    haEntityIds: (node: PumpNode, device) => ({
      relay: deriveHaEntityId('switch', device, haNames(node).relay),
    }),
  },

  rules: [
    {
      id: 'pump-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => !n['pin'])
        .map(n => ({
          message: `Pump "${n['name'] ?? n['id']}": Relay Pin not configured`,
          target: String(n['id']),
        })),
    },
    {
      id: 'pump-active-high-wiring-hint',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => n['relay_polarity'] === 'active_high')
        .map(n => ({
          message: `Pump "${n['name'] ?? n['id']}": active-high polarity selected — verify the relay module's NC contact is wired to the load, otherwise the load will be energized at MCU power-off (boot, reset, brown-out).`,
          target: String(n['id']),
        })),
    },
  ],
};
