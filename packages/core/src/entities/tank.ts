import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema, escXml } from '../schemas';
import { UI_COLORS } from '../colors';
import { tankLevelId, tankRawVoltageId, tankCalEmptyId, tankCalFullId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';

const COLOR = '#14b8a6'; // teal
const W = 120, H = 70;

// --- Schema ---

export const TankNodeSchema = z.object({
  kind: z.literal('tank'),
  id: ComponentId,
  name: z.string().min(1),
  level_pin: GpioPin.optional(),
  /** True if level sensor is rated for reliable readings during pump operation (e.g., pressure transducer). */
  pump_rated: z.boolean().default(false),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type TankNode = z.infer<typeof TankNodeSchema>;

// --- Descriptor ---

export const tankDescriptor: NodeDescriptor = {
  kind: 'tank',
  label: 'Tank',
  isLevelSensor: true,
  conflictClass: 'sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation-guidelines.md#tank-level-sensors',
  schema: TankNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  portLayout: { inlet: { y: 15 }, outlet: { y: 55 } },
  defaultData: (n) => ({ name: `Tank ${n}`, level_pin: '', pump_rated: false }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Tank';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="5" y="30" width="${W - 10}" height="${H - 33}" rx="2" fill="${UI_COLORS.water}" opacity="0.5"/>
      <path d="M 3 8 L 3 ${H - 3} Q 3 ${H} 9 ${H} L ${W - 9} ${H} Q ${W - 3} ${H} ${W - 3} ${H - 3} L ${W - 3} 8" fill="none" stroke="${COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${W / 2}" y="20" text-anchor="middle" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  sidebarFields: [
    { key: 'level_pin', label: 'Level Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
    { key: 'pump_rated', label: 'Pump-rated sensor', type: 'toggle' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node: TankNode, idx, ctx) => {
      if (!node.level_pin) return '';
      const lvlId = tankLevelId(node);
      const rawId = tankRawVoltageId(node);
      const calEmpty = tankCalEmptyId(node);
      const calFull = tankCalFullId(node);
      const header = resolveComponentHeader(ctx, node.level_pin, { purpose: 'adc' });
      return `\
${header}
  id: ${lvlId}
  name: "${node.name} Level"
  unit_of_measurement: "%"
  icon: "mdi:storage-tank"
  update_interval: \${update_interval}
  filters:
    - lambda: |-
        id(${rawId}).publish_state(x);
        return x;
    - median:
        window_size: 5
        send_every: 1
    - sliding_window_moving_average:
        window_size: 5
        send_every: 1
    - lambda: |-
        float v_empty = id(${calEmpty}).state;
        float v_full  = id(${calFull}).state;
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
  id: ${rawId}
  name: "${node.name} Raw Voltage"
  unit_of_measurement: "V"
  icon: "mdi:flash-triangle"
  accuracy_decimals: 3
  entity_category: diagnostic`;
    },

    extraComponents: (node: TankNode): Record<string, string> => {
      if (!node.level_pin) return {};
      const calEmpty = tankCalEmptyId(node);
      const calFull = tankCalFullId(node);
      return {
        number: `\
- platform: template
  name: "${node.name} Cal Empty V"
  id: ${calEmpty}
  icon: "mdi:tune-vertical"
  min_value: 0.0
  max_value: 3.3
  step: 0.001
  initial_value: 0.0
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${node.name} Cal Full V"
  id: ${calFull}
  icon: "mdi:tune-vertical"
  min_value: 0.0
  max_value: 3.3
  step: 0.001
  initial_value: 3.3
  optimistic: true
  restore_value: true
  entity_category: config`,
      };
    },

    substitutions: () => [],
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
};
