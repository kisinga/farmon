import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#78716c'; // stone
const W = 50, H = 36;

// --- Schema ---

export const FilterNodeSchema = z.object({
  kind: z.literal('filter'),
  id: ComponentId,
  name: z.string().min(1),
  inlet_pressure_pin: GpioPin.optional(),
  outlet_pressure_pin: GpioPin.optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type FilterNode = z.infer<typeof FilterNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('filter', {
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

  // No codegen — experimental, UI only.

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
});
