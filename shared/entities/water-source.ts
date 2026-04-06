import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#0ea5e9'; // sky blue
const W = 120, H = 50;

// --- Schema ---

export const WaterSourceNodeSchema = z.object({
  kind: z.literal('water_source'),
  id: ComponentId,
  name: z.string().min(1),
  pressure_pin: GpioPin.optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type WaterSourceNode = z.infer<typeof WaterSourceNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('water_source', {
  kind: 'water_source',
  label: 'Water Source',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation-guidelines.md#pressure-sensors',
  schema: WaterSourceNodeSchema,
  defaultPorts: [
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Source ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Source';
    const icy = H / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2"/>
      <path d="M 14 ${icy - 9} Q 25 ${icy} 14 ${icy + 9}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 21 ${icy - 7} Q 30 ${icy} 21 ${icy + 7}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
      <text x="40" y="${icy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="${COLOR}" stroke-width="1.5"/><path d="M6 4 Q12 8 6 12" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/><path d="M10 5 Q15 8 10 11" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/></svg>`,

  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
    { key: 'pressure_pin', label: 'Pressure Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node) => {
      if (!node['pressure_pin']) return '';
      return `\
  - platform: adc
    pin: \${pin_${node['id']}_pressure}
    id: ${node['id']}_pressure
    name: "${node['name']} Pressure"
    unit_of_measurement: "bar"
    icon: "mdi:gauge"
    update_interval: \${update_interval}
    attenuation: 12db
    accuracy_decimals: 2`;
    },

    substitutions: (node) => {
      const lines: string[] = [];
      if (node['pressure_pin']) {
        lines.push(`pin_${node['id']}_pressure: "${node['pressure_pin']}"`);
      }
      return lines;
    },
  },

  // --- Validation ---

  rules: [{
    id: 'water-source-pressure-warning',
    severity: 'warning',
    evaluate: (sources) => sources
      .filter(ws => !ws['pressure_pin'])
      .map(ws => ({
        message: `Water source "${ws['id']}": no pressure sensor configured. Incoming supply pressure will not be monitored.`,
        target: ws['id'],
      })),
  }],
});
