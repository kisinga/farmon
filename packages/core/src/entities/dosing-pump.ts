import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema, RelayPolaritySchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { dosingPumpSwitchId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields, deriveHaEntityId } from '../ha';

const COLOR = '#ea580c'; // orange
const S = 50;

// --- Schema ---

export const DosingPumpNodeSchema = z.object({
  kind: z.literal('dosing_pump'),
  id: ComponentId,
  name: EntityName,
  pin: GpioPin,
  relay_polarity: RelayPolaritySchema,
  flow_rate_ml_min: z.number().default(100),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
});

export type DosingPumpNode = z.infer<typeof DosingPumpNodeSchema>;

// Single source of truth for dosing pump HA entity names. Note: the
// firmware-emitted switch is currently `internal: true`, which suppresses
// HA discovery. The dashboard references this entity_id anyway — that
// pre-existing inconsistency will be surfaced by the cross-validation test
// as a real bug to fix outside this refactor.
const haNames = (node: DosingPumpNode) => ({
  relay: `${node.name} Relay`,
});

// --- Descriptor ---

export const dosingPumpDescriptor: NodeDescriptor = {
  kind: 'dosing_pump',
  label: 'Dosing Pump',
  // No isPump — a dosing pump is a chemical injector, not a circulation pump.
  // It has its own relay ID (dosingPumpSwitchId) and does not participate in
  // pump refcounting or share the pump_relay component ID.
  conflictClass: 'actuator',
  color: COLOR,
  size: { width: S, height: S },
  role: 'passthrough',
  category: 'actuator',
  group: 'pump',
  experimental: true,
  schema: DosingPumpNodeSchema,
  haDomain: 'switch',
  defaultHaActions: [
    { id: 'more-info', label: 'More info' },
    { id: 'toggle', label: 'Toggle', service: 'switch.toggle' },
  ],
  defaultBinds: { label: 'state' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Doser ${n}`, pin: '', relay_polarity: 'active_low', flow_rate_ml_min: 100 }),

  renderSvg: (_data) => {
    const cx = S / 2, cy = S / 2, r = S / 2 - 5;
    // Circle with droplet icon — distinguishes from main pump's play triangle
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="M ${cx} ${cy - 10} Q ${cx + 6} ${cy - 2} ${cx + 6} ${cy + 2} A 6 6 0 0 1 ${cx - 6} ${cy + 2} Q ${cx - 6} ${cy - 2} ${cx} ${cy - 10}" fill="${COLOR}" fill-opacity="0.6"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42', pinCap: 'digital', polarityKey: 'relay_polarity' },
    { key: 'relay_polarity', label: 'Relay polarity', type: 'select', options: [
      { value: 'active_low', label: 'Active-low (default)' },
      { value: 'active_high', label: 'Active-high' },
    ] },
    { key: 'flow_rate_ml_min', label: 'Rate (mL/min)', type: 'number' },
  ],

  constraints: [
    { type: 'presence', id: 'dosing-downstream-flow', requiredKind: ['flow_sensor'],
      position: 'downstream', baseSeverity: 'warning',
      description: 'Flow sensor recommended downstream of dosing pump for injection verification' },
  ] satisfies FlowConstraint[],

  // --- Codegen ---

  codegen: {
    hardware: (node: DosingPumpNode, _idx, ctx) => {
      const id = dosingPumpSwitchId(node);
      const inverted = node.relay_polarity !== 'active_high';
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'digital_out', inverted });
      return `\
# --- ${node.name} ---
${header}
  id: ${id}
  name: "${haNames(node).relay}"
  icon: "mdi:pump"
  internal: true
  restore_mode: ALWAYS_OFF`;
    },

    substitutions: () => [],

    haEntityIds: (node: DosingPumpNode, device) => ({
      relay: deriveHaEntityId('switch', device, haNames(node).relay),
    }),
  },

  rules: [
    {
      id: 'dosing-pump-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => !n['pin'])
        .map(n => ({
          message: `Dosing pump "${n['name'] ?? n['id']}": Relay Pin not configured`,
          target: String(n['id']),
        })),
    },
    {
      id: 'dosing-pump-active-high-wiring-hint',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => n['relay_polarity'] === 'active_high')
        .map(n => ({
          message: `Dosing pump "${n['name'] ?? n['id']}": active-high polarity selected — verify the relay module's NC contact is wired to the load, otherwise the load will be energized at MCU power-off (boot, reset, brown-out).`,
          target: String(n['id']),
        })),
    },
  ],
};
