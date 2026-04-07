import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#14b8a6'; // teal
const W = 120, H = 70;

// --- Schema ---

export const TankNodeSchema = z.object({
  kind: z.literal('tank'),
  id: ComponentId,
  name: z.string().min(1),
  level_pin: GpioPin.optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type TankNode = z.infer<typeof TankNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('tank', {
  kind: 'tank',
  label: 'Tank',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation-guidelines.md#tank-level-sensors',
  schema: TankNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet', y: 15 },
    { id: 'outlet', label: 'Outlet', direction: 'outlet', y: 55 },
  ],
  defaultData: (n) => ({ name: `Tank ${n}`, level_pin: '' }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Tank';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="5" y="30" width="${W - 10}" height="${H - 33}" rx="2" fill="${UI_COLORS.water}" opacity="0.5"/>
      <path d="M 3 8 L 3 ${H - 3} Q 3 ${H} 9 ${H} L ${W - 9} ${H} Q ${W - 3} ${H} ${W - 3} ${H - 3} L ${W - 3} 8" fill="none" stroke="${COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${W / 2}" y="20" text-anchor="middle" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><path d="M1 2 L1 14 Q1 15 3 15 L17 15 Q19 15 19 14 L19 2" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/><rect x="3" y="7" width="14" height="7" rx="1" fill="#bae6fd" opacity="0.5"/></svg>`,

  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
    { key: 'level_pin', label: 'Level Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node, idx) => {
      if (!node['level_pin']) return '';
      return `\
  - platform: adc
    pin: \${pin_${node['id']}_level}
    id: ${node['id']}_level
    name: "${node['name']} Level"
    unit_of_measurement: "%"
    icon: "mdi:storage-tank"
    update_interval: \${update_interval}
    attenuation: 12db
    filters:
      - lambda: |-
          id(${node['id']}_raw_voltage).publish_state(x);
          float v_empty = id(${node['id']}_cal_empty).state;
          float v_full  = id(${node['id']}_cal_full).state;
          if (v_full <= v_empty) return 0.0f;
          float pct = (x - v_empty) / (v_full - v_empty) * 100.0f;
          return clamp(pct, 0.0f, 100.0f);
      - lambda: |-
          const int TANK_IDX = ${idx};
          for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
            if (slots[s].state < 1 || slots[s].state > 3 || slots[s].route_id < 0) continue;
            const Route& r = ROUTES[slots[s].route_id];
            if (r.source_tank == TANK_IDX || r.dest_tank == TANK_IDX) return {};
          }
          return x;

  - platform: template
    id: ${node['id']}_raw_voltage
    name: "${node['name']} Raw Voltage"
    unit_of_measurement: "V"
    icon: "mdi:flash-triangle"
    accuracy_decimals: 3
    entity_category: diagnostic`;
    },

    substitutions: (node) => {
      const lines: string[] = [];
      if (node['level_pin']) {
        lines.push(`pin_${node['id']}_level: "${node['level_pin']}"`);
      }
      return lines;
    },
  },

  // --- Validation ---

  rules: [{
    id: 'tank-level-warning',
    severity: 'warning',
    evaluate: (tanks) => tanks
      .filter(t => !t['level_pin'])
      .map(t => ({
        message: `Tank "${t['id']}": no level sensor configured. Pre-flight level checks and automated refill will not be available for this tank.`,
        target: t['id'],
      })),
  }],
});
