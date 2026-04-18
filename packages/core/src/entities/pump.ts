import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { pumpSwitchId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';

const COLOR = '#dc2626'; // red
const S = 60;

// --- Schema ---

export const PumpNodeSchema = z.object({
  kind: z.literal('pump'),
  id: ComponentId,
  name: z.string().default('Pump'),
  pin: GpioPin,
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
});

export type PumpNode = z.infer<typeof PumpNodeSchema>;

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
  defaultPorts: [
    { id: 'in', label: 'Inlet', direction: 'inlet' },
    { id: 'out', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: () => ({ name: 'Pump', pin: '' }),

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
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42' },
  ],

  constraints: [
    { type: 'presence', id: 'pump-inlet-valve', requiredKind: 'valve',
      position: 'upstream', baseSeverity: 'error',
      description: 'Isolation valve required before pump inlet' },
    { type: 'presence', id: 'pump-downstream-flow', requiredKind: 'flow_sensor',
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
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'digital_out', inverted: true });
      return `\
# --- Pump relay ------------------------------------------------------------
${header}
  id: ${id}
  name: "Pump Relay"
  icon: "mdi:water-pump"
  internal: true
  restore_mode: ALWAYS_OFF
  on_turn_on:
    - if:
        condition:
          lambda: 'return pump_ref_count() == 0;'
        then:
          - switch.turn_off: ${id}
          - logger.log: {level: WARN, format: "BLOCKED: pump only runs when a pumped route is RUNNING"}`;
    },

    substitutions: () => [],
  },
};
