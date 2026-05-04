import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { filterInletPressureId, filterOutletPressureId, filterDeltaPressureId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import { HaNodeFields, deriveHaEntityId } from '../ha';

const COLOR = '#78716c'; // stone
const W = 50, H = 36;

// --- Schema ---

export const FilterNodeSchema = z.object({
  kind: z.literal('filter'),
  id: ComponentId,
  name: EntityName,
  inlet_pressure_pin: GpioPin.optional(),
  outlet_pressure_pin: GpioPin.optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
});

export type FilterNode = z.infer<typeof FilterNodeSchema>;

// Single source of truth for filter HA entity names. Each entry is conditional
// on the corresponding pressure pin being configured; both firmware emit and
// HA reference gate identically.
const haNames = (node: FilterNode) => ({
  inletPressure:  `${node.name} Inlet Pressure`,
  outletPressure: `${node.name} Outlet Pressure`,
  deltaPressure:  `${node.name} Differential Pressure`,
});

// --- Descriptor ---

export const filterDescriptor: NodeDescriptor = {
  kind: 'filter',
  label: 'Filter',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'infrastructure',
  group: 'infrastructure',
  experimental: true,
  schema: FilterNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Filter ${n}`, inlet_pressure_pin: '', outlet_pressure_pin: '' }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2;
    // Grid/mesh pattern inside a rectangle
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="5" y="4" width="${W - 10}" height="${H - 8}" rx="3" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <line x1="15" y1="4" x2="15" y2="${H - 4}" stroke="${COLOR}" stroke-width="1.5" opacity="0.4"/>
      <line x1="25" y1="4" x2="25" y2="${H - 4}" stroke="${COLOR}" stroke-width="1.5" opacity="0.4"/>
      <line x1="35" y1="4" x2="35" y2="${H - 4}" stroke="${COLOR}" stroke-width="1.5" opacity="0.4"/>
      <line x1="5" y1="12" x2="${W - 5}" y2="12" stroke="${COLOR}" stroke-width="1.5" opacity="0.4"/>
      <line x1="5" y1="24" x2="${W - 5}" y2="24" stroke="${COLOR}" stroke-width="1.5" opacity="0.4"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'inlet_pressure_pin', label: 'Inlet Pressure', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
    { key: 'outlet_pressure_pin', label: 'Outlet Pressure', type: 'pin', placeholder: 'GPIO20', pinCap: 'adc' },
  ],

  constraints: [
    { type: 'presence', id: 'filter-upstream-valve', requiredKind: ['valve'],
      position: 'upstream', baseSeverity: 'error',
      description: 'Isolation valve required before filter for maintenance bypass' },
  ] satisfies FlowConstraint[],

  // --- Codegen ---

  codegen: {
    sensors: (node: FilterNode, _idx, ctx) => {
      const parts: string[] = [];
      const names = haNames(node);
      if (node.inlet_pressure_pin) {
        const id = filterInletPressureId(node);
        const header = resolveComponentHeader(ctx, node.inlet_pressure_pin, { purpose: 'adc' });
        parts.push(`\
${header}
  id: ${id}
  name: "${names.inletPressure}"
  unit_of_measurement: "bar"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  accuracy_decimals: 2`);
      }
      if (node.outlet_pressure_pin) {
        const id = filterOutletPressureId(node);
        const header = resolveComponentHeader(ctx, node.outlet_pressure_pin, { purpose: 'adc' });
        parts.push(`\
${header}
  id: ${id}
  name: "${names.outletPressure}"
  unit_of_measurement: "bar"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  accuracy_decimals: 2`);
      }
      if (node.inlet_pressure_pin && node.outlet_pressure_pin) {
        const inId = filterInletPressureId(node);
        const outId = filterOutletPressureId(node);
        const deltaId = filterDeltaPressureId(node);
        parts.push(`\
- platform: template
  id: ${deltaId}
  name: "${names.deltaPressure}"
  unit_of_measurement: "bar"
  icon: "mdi:delta"
  accuracy_decimals: 2
  update_interval: \${update_interval}
  lambda: |-
    float inlet = id(${inId}).state;
    float outlet = id(${outId}).state;
    if (std::isnan(inlet) || std::isnan(outlet)) return NAN;
    return inlet - outlet;`);
      }
      return parts.join('\n');
    },

    substitutions: () => [],

    haEntityIds: (node: FilterNode, device) => {
      const n = haNames(node);
      return {
        inletPressure:  node.inlet_pressure_pin
          ? deriveHaEntityId('sensor', device, n.inletPressure) : undefined,
        outletPressure: node.outlet_pressure_pin
          ? deriveHaEntityId('sensor', device, n.outletPressure) : undefined,
        deltaPressure:  (node.inlet_pressure_pin && node.outlet_pressure_pin)
          ? deriveHaEntityId('sensor', device, n.deltaPressure) : undefined,
      };
    },
  },

  rules: [{
    id: 'filter-pressure-warning',
    severity: 'warning',
    evaluate: (nodes) => nodes
      .filter(n => !n['inlet_pressure_pin'] && !n['outlet_pressure_pin'])
      .map(n => ({
        message: `Filter "${n['name']}": no pressure pins configured. Blockage detection will not be available.`,
        target: String(n['id']),
      })),
  }],
};
