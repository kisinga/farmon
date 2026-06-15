import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema, RelayPolaritySchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { SYMBOL } from '../symbol-style';
import type { FlowConstraint } from '../graph/constraints';
import { pumpSwitchId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { udpSwitchProxy, udpSwitchProxyLeaseInterval } from '../remote-proxy';

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
  anchorId: AnchorIdSchema,
});

export type PumpNode = z.infer<typeof PumpNodeSchema>;

// Single source of truth for the pump's emitted entity name, read by the
// firmware-emit side (codegen.hardware).
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
      return `<path d="M 0 0 Q ${cpx} ${cpy} ${ex} ${ey}" fill="none" stroke="${COLOR}" stroke-width="${SYMBOL.detail}" stroke-linecap="round"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle data-part="body" cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="${SYMBOL.stroke}"/>
      <line x1="${cx + r}" y1="${cy}" x2="${S}" y2="${cy}" stroke="${COLOR}" stroke-width="${SYMBOL.stub}" stroke-linecap="round"/>
      <line x1="0" y1="${cy}" x2="${cx - r}" y2="${cy}" stroke="${COLOR}" stroke-width="${SYMBOL.stub}" stroke-linecap="round"/>
      <g transform="translate(${cx},${cy})"><g data-part="spin">${vanes}<circle r="3" fill="${COLOR}"/></g></g>
    </svg>`;
  },

  // Live map: the impeller spins while running. It's an inner group with no
  // transform of its own (the outer group centres it), so the shared
  // `[data-part=spin]` rule (`fill-box`+`center`) rotates it cleanly in place.
  live: { spin: true },

  sidebarFields: [
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42', pinCap: 'digital', polarityKey: 'relay_polarity' },
    { key: 'relay_polarity', label: 'Relay polarity', type: 'select', options: [
      { value: 'active_low', label: 'Active-low (default)' },
      { value: 'active_high', label: 'Active-high' },
    ] },
  ],

  safetyProfile: {
    safetyCritical: true,
    requiredSensors: [
      { kind: 'flow_sensor', position: 'downstream', severity: 'error', reason: 'dry-run protection' },
    ],
    deadManTimeoutMs: 30000,
    deadManAction: 'stop',
  },

  constraints: [
    { type: 'presence', id: 'pump-inlet-valve', requiredKind: ['valve'],
      position: 'upstream', baseSeverity: 'warning',
      description: 'Isolation valve recommended before pump inlet' },
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
      const id = pumpSwitchId(node.id);
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
          # Claims are keyed by the topology node id (the registry key extend_deadman
          # uses), NOT the relay id — a cross-controller claim on a non-brain owner
          # (pump_ref_count==0) must be seen here or this interlock fights pumpMgmt.
          lambda: 'return pump_ref_count(pump_index_for_id("${id}")) == 0 && !has_live_claim("${node.id}") && !id(safety_override).state;'
        then:
          - switch.turn_off: ${id}
          - logger.log: {level: WARN, format: "BLOCKED: pump only runs during a route or when safety_override is ON"}`;
    },

    substitutions: () => [],

    remoteProxy: (node) => {
      const proxyId = pumpSwitchId(node.id);
      return [
        { section: 'switch', yaml: udpSwitchProxy(proxyId, node.name ?? 'Pump', node.id) },
        { section: 'interval', yaml: udpSwitchProxyLeaseInterval(proxyId, node.id) },
      ];
    },

  },

  rules: [
    {
      id: 'pump-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => !(n as Record<string, unknown>)['pin'])
        .map(n => ({
          message: `Pump "${n.name ?? n.id}": Relay Pin not configured`,
          target: n.id,
        })),
    },
    {
      id: 'pump-active-high-wiring-hint',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => (n as Record<string, unknown>)['relay_polarity'] === 'active_high')
        .map(n => ({
          message: `Pump "${n.name ?? n.id}": active-high polarity selected — verify the relay module's NC contact is wired to the load, otherwise the load will be energized at MCU power-off (boot, reset, brown-out).`,
          target: n.id,
        })),
    },
  ],
};
