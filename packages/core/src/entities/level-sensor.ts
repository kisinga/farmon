import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { levelSensorLevelId, levelSensorRawVoltageId, levelSensorCalEmptyId, levelSensorCalFullId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import type { FlowConstraint } from '../graph/constraints';
import { HaNodeFields, deriveHaEntityId } from '../ha';
import { homeassistantSensorImport } from '../remote-proxy';

const COLOR = '#0ea5e9'; // sky blue
const W = 50, H = 36;

// --- Schema ---

// Level sensors are intrinsically tank-mounted: they read static fluid level
// from a tank, so pump operation cannot disturb the reading. They are
// therefore unconditionally pump-safe and carry no pump_rated flag.
export const LevelSensorNodeSchema = z.object({
  kind: z.literal('level_sensor'),
  id: ComponentId,
  name: EntityName,
  pin: GpioPin,
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  anchorId: AnchorIdSchema,
});

export type LevelSensorNode = z.infer<typeof LevelSensorNodeSchema>;

// Single source of truth for level sensor HA entity names. Both firmware
// emit (codegen.sensors / extraComponents) and HA reference
// (codegen.haEntityIds) read from this — they cannot drift.
const haNames = (node: LevelSensorNode) => ({
  level:      `${node.name} Level`,
  rawVoltage: `${node.name} Raw Voltage`,
  calEmpty:   `${node.name} Cal Empty V`,
  calFull:    `${node.name} Cal Full V`,
});

// --- Descriptor ---

export const levelSensorDescriptor: NodeDescriptor = {
  kind: 'level_sensor',
  label: 'Level Sensor',
  isLevelSensor: true,
  conflictClass: 'sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  group: 'sensor',
  schema: LevelSensorNodeSchema,
  haDomain: 'sensor',
  defaultHaActions: [{ id: 'more-info', label: 'More info' }],
  defaultBinds: { label: 'state|format:percent' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Level ${n}`, pin: '' }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    // Water-level icon: waves inside a circle
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="M ${cx - 8} ${cy + 2} Q ${cx - 4} ${cy - 3} ${cx} ${cy + 2} Q ${cx + 4} ${cy + 7} ${cx + 8} ${cy + 2}" fill="none" stroke="${COLOR}" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy - 8}" x2="${cx}" y2="${cy + 1}" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <line x1="${cx - 3}" y1="${cy - 5}" x2="${cx + 3}" y2="${cy - 5}" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node: LevelSensorNode, idx, ctx) => {
      const lvlId = levelSensorLevelId(node);
      const rawId = levelSensorRawVoltageId(node);
      const calEmpty = levelSensorCalEmptyId(node);
      const calFull = levelSensorCalFullId(node);
      const header = resolveComponentHeader(ctx, node.pin, { purpose: 'adc' });
      const names = haNames(node);
      return `\
${header}
  id: ${lvlId}
  name: "${names.level}"
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
        const int LEVEL_SENSOR_IDX = ${idx};
        for (int s = 0; s < MAX_CONCURRENT_ROUTES; s++) {
          if (slots[s].state < 1 || slots[s].state > 3 || slots[s].route_id < 0) continue;
          const Route& r = ROUTES[slots[s].route_id];
          if (r.source_tank == LEVEL_SENSOR_IDX || r.dest_tank == LEVEL_SENSOR_IDX) return {};
        }
        return x;

- platform: template
  id: ${rawId}
  name: "${names.rawVoltage}"
  unit_of_measurement: "V"
  icon: "mdi:flash-triangle"
  accuracy_decimals: 3
  entity_category: diagnostic`;
    },

    extraComponents: (node: LevelSensorNode): Record<string, string> => {
      const calEmpty = levelSensorCalEmptyId(node);
      const calFull = levelSensorCalFullId(node);
      const names = haNames(node);
      return {
        number: `\
- platform: template
  name: "${names.calEmpty}"
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
  name: "${names.calFull}"
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

    haEntityIds: (node: LevelSensorNode, device) => {
      const n = haNames(node);
      return {
        level:      deriveHaEntityId('sensor', device, n.level),
        rawVoltage: deriveHaEntityId('sensor', device, n.rawVoltage),
        calEmpty:   deriveHaEntityId('number', device, n.calEmpty),
        calFull:    deriveHaEntityId('number', device, n.calFull),
      };
    },

    remoteProxy: (node, haEntityId) => ({
      section: 'sensor',
      yaml: homeassistantSensorImport(node.id, haEntityId),
    }),

  },

  constraints: [] satisfies FlowConstraint[],

  // --- Validation ---

  rules: [{
    id: 'level-sensor-pin-required',
    severity: 'error',
    evaluate: (nodes) => nodes
      .filter(n => !(n as Record<string, unknown>)['pin'])
      .map(n => ({
        message: `Level sensor "${n.name}": no pin assigned. Level sensors require an ADC pin.`,
        target: n.id,
      })),
  }],
};
