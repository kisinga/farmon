import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import {
  pressureSensorId,
  pressureSensorRangeMinId,
  pressureSensorRangeMaxId,
  pressureSensorCalEmptyId,
  pressureSensorCalFullId,
  pressureSensorLevelId,
} from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';
import type { FlowConstraint } from '../graph/constraints';
import { HaNodeFields, deriveHaEntityId } from '../ha';

const COLOR = '#8b5cf6'; // violet
const W = 50, H = 36;

// --- Schema ---

export const PressureSensorNodeSchema = z.object({
  kind: z.literal('pressure_sensor'),
  id: ComponentId,
  name: EntityName,
  pin: GpioPin,
  /** Initial sensor electrical range (bar). Seeds the runtime-tunable
   *  Sensor Min / Sensor Max HA entities; not baked into firmware. */
  min_bar: z.number().default(0),
  max_bar: z.number().default(10),
  /** True if the sensor is rated for reliable readings during pump operation.
   *  Pressure transducers generally are; defaults to true. */
  pump_rated: z.boolean().default(true),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
});

export type PressureSensorNode = z.infer<typeof PressureSensorNodeSchema>;

// Single source of truth for pressure sensor HA entity names. Both the
// firmware-emit side (codegen.sensors / extraComponents) and the HA-reference
// side (codegen.haEntityIds) read from this — they cannot drift.
const haNames = (node: PressureSensorNode) => ({
  pressure: `${node.name} Pressure`,
  rangeMin: `${node.name} Sensor Min (bar)`,
  rangeMax: `${node.name} Sensor Max (bar)`,
  calEmpty: `${node.name} Cal Empty (bar)`,
  calFull:  `${node.name} Cal Full (bar)`,
  level:    `${node.name} Level`,
});

// --- Descriptor ---

export const pressureSensorDescriptor: NodeDescriptor = {
  kind: 'pressure_sensor',
  label: 'Pressure Sensor',
  isPressureSensor: true,
  conflictClass: 'sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  group: 'sensor',
  schema: PressureSensorNodeSchema,
  haDomain: 'sensor',
  defaultHaActions: [{ id: 'more-info', label: 'More info' }],
  defaultBinds: { label: 'state|format:number:2' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Pressure ${n}`, pin: '', min_bar: 0, max_bar: 10, pump_rated: true }),

  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="M ${cx - 7} ${cy + 5} A 9 9 0 0 1 ${cx + 7} ${cy + 5}" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy + 3}" x2="${cx + 5}" y2="${cy - 6}" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy + 3}" r="2" fill="${COLOR}"/>
    </svg>`;
  },

  sidebarFields: [
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
    { key: 'min_bar', label: 'Sensor min (bar, seed)', type: 'number' },
    { key: 'max_bar', label: 'Sensor max (bar, seed)', type: 'number' },
    { key: 'pump_rated', label: 'Pump-rated sensor', type: 'toggle' },
  ],

  // --- Codegen (native — full support) ---

  codegen: {
    sensors: (node: PressureSensorNode, _idx, ctx) => {
      const sId      = pressureSensorId(node);
      const levelId  = pressureSensorLevelId(node);
      const rangeMin = pressureSensorRangeMinId(node);
      const rangeMax = pressureSensorRangeMaxId(node);
      const calEmpty = pressureSensorCalEmptyId(node);
      const calFull  = pressureSensorCalFullId(node);
      const header   = resolveComponentHeader(ctx, node.pin, { purpose: 'adc' });
      const names    = haNames(node);
      return `\
${header}
  id: ${sId}
  name: "${names.pressure}"
  unit_of_measurement: "bar"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  accuracy_decimals: 2
  filters:
    - median:
        window_size: 5
        send_every: 1
    - sliding_window_moving_average:
        window_size: 5
        send_every: 1
    - lambda: |-
        float r_min = id(${rangeMin}).state;
        float r_max = id(${rangeMax}).state;
        if (std::isnan(r_min) || std::isnan(r_max) || r_max <= r_min) return x;
        return r_min + (x / 3.3f) * (r_max - r_min);

- platform: template
  id: ${levelId}
  name: "${names.level}"
  unit_of_measurement: "%"
  icon: "mdi:storage-tank"
  update_interval: \${update_interval}
  accuracy_decimals: 1
  lambda: |-
      float p   = id(${sId}).state;
      float p_e = id(${calEmpty}).state;
      float p_f = id(${calFull}).state;
      if (std::isnan(p) || std::isnan(p_e) || std::isnan(p_f) || p_f <= p_e) return {};
      float pct = (p - p_e) / (p_f - p_e) * 100.0f;
      return clamp(pct, 0.0f, 100.0f);`;
    },

    extraComponents: (node: PressureSensorNode): Record<string, string> => {
      const rangeMin = pressureSensorRangeMinId(node);
      const rangeMax = pressureSensorRangeMaxId(node);
      const calEmpty = pressureSensorCalEmptyId(node);
      const calFull  = pressureSensorCalFullId(node);
      const names    = haNames(node);
      return {
        number: `\
- platform: template
  name: "${names.rangeMin}"
  id: ${rangeMin}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 30
  step: 0.1
  initial_value: ${node.min_bar}
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.rangeMax}"
  id: ${rangeMax}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 30
  step: 0.1
  initial_value: ${node.max_bar}
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.calEmpty}"
  id: ${calEmpty}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 30
  step: 0.01
  initial_value: 0
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.calFull}"
  id: ${calFull}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 30
  step: 0.01
  initial_value: ${node.max_bar}
  optimistic: true
  restore_value: true
  entity_category: config`,
      };
    },

    substitutions: () => [],

    haEntityIds: (node: PressureSensorNode, device) => {
      const n = haNames(node);
      return {
        pressure: deriveHaEntityId('sensor', device, n.pressure),
        level:    deriveHaEntityId('sensor', device, n.level),
        rangeMin: deriveHaEntityId('number', device, n.rangeMin),
        rangeMax: deriveHaEntityId('number', device, n.rangeMax),
        calEmpty: deriveHaEntityId('number', device, n.calEmpty),
        calFull:  deriveHaEntityId('number', device, n.calFull),
      };
    },
  },

  constraints: [] satisfies FlowConstraint[],

  // --- Validation ---
  // TODO: Redundant pin validation — this entity rule AND the generic pin check
  // both fire for empty pin, producing a double error message. Deduplicate when
  // adding more entity rules.

  rules: [{
    id: 'pressure-sensor-pin-required',
    severity: 'error',
    evaluate: (nodes) => nodes
      .filter(n => !n['pin'])
      .map(n => ({
        message: `Pressure sensor "${n['name']}": no pin assigned. Standalone pressure sensors require an ADC pin.`,
        target: String(n['id']),
      })),
  }],
};
