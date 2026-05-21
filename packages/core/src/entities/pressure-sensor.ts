import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { RemoteBindingSchema } from '../schemas';
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
import { homeassistantSensorImport } from '../remote-proxy';
import { deriveTankCalibration, recommendSensorMaxPsi } from '../units';

const COLOR = '#8b5cf6'; // violet
const W = 50, H = 36;
const POOR_PRESSURE_SPAN_PCT = 15;

// --- Schema ---
//
// Tank geometry (height, capacity) lives on the tank node, not on the sensor:
// the tank is the single source of truth for its own dimensions. When a
// pressure sensor sits downstream of a tank, the manifest pass annotates this
// node with the resolved `tank_height_m` / `tank_capacity_l` so codegen and
// validation continue to see them in the same shape. Pressure sensors used
// for plain line-pressure monitoring (no upstream tank) carry no tank dims —
// only `sensor_max_psi` matters.

export const PressureSensorNodeSchema = z.object({
  kind: z.literal('pressure_sensor'),
  id: ComponentId,
  name: EntityName,
  pin: GpioPin,
  /**
   * Vertical drop from the tank's bottom outlet down to the sensor location,
   * metres. Stays full of water once the system is primed, so it shifts the
   * empty-tank reading by PSI_PER_M · elevation_m.
   */
  elevation_m: z.number().nonnegative().default(0),
  /** Sensor's full-scale rating, psi (datasheet value, e.g. 5/10/15/30). */
  sensor_max_psi: z.number().positive(),
  /** True if the sensor is rated for reliable readings during pump operation. */
  pump_rated: z.boolean().default(false),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  remote: RemoteBindingSchema.optional(),
});

export type PressureSensorNode = z.infer<typeof PressureSensorNodeSchema>;

// Single source of truth for pressure sensor HA entity names. Both the
// firmware-emit side (codegen.sensors / extraComponents) and the HA-reference
// side (codegen.haEntityIds) read from this — they cannot drift.
const haNames = (node: PressureSensorNode) => ({
  pressure: `${node.name} Pressure`,
  rangeMin: `${node.name} Sensor Min (psi)`,
  rangeMax: `${node.name} Sensor Max (psi)`,
  calEmpty: `${node.name} Cal Empty (psi)`,
  calFull:  `${node.name} Cal Full (psi)`,
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
  defaultData: (n) => ({
    name: `Pressure ${n}`,
    pin: '',
    elevation_m: 0,
    sensor_max_psi: 15,
    pump_rated: false,
  }),

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
    { key: 'elevation_m', label: 'Sensor drop below tank (m)', type: 'number', hint: 'Vertical drop from tank outlet down to sensor. Stays full of water — shifts the empty-tank reading.' },
    { key: 'sensor_max_psi', label: 'Sensor max (psi)', type: 'number', hint: 'Datasheet full-scale value, e.g. 5 / 10 / 15 / 30 psi.' },
    {
      key: 'pump_rated',
      label: 'Reading reliable while pump runs',
      type: 'toggle',
      hint: 'Tank-mounted sensors read static head and stay reliable during pump operation. Sensors plumbed inline on the line near a pump are disturbed by flow — leave this off for those.',
    },
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
  unit_of_measurement: "psi"
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
      // When tank geometry is absent (line-pressure use), seed Cal Empty / Full
      // with a span of 0 → sensor_max_psi so the level entity stays inert until
      // the installer enters real values via the HA tunables. `tank_height_m`
      // and `tank_capacity_l` are not on the schema — the manifest pass
      // annotates them onto this node from the parent tank when applicable.
      const tankHeight = (node as { tank_height_m?: number }).tank_height_m;
      const cal = tankHeight != null
        ? deriveTankCalibration(tankHeight, node.elevation_m)
        : { p_empty_psi: 0, p_full_psi: node.sensor_max_psi, working_span_psi: node.sensor_max_psi };
      const fmt = (v: number) => v.toFixed(2);
      return {
        number: `\
- platform: template
  name: "${names.rangeMin}"
  id: ${rangeMin}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: 0
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.rangeMax}"
  id: ${rangeMax}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${node.sensor_max_psi}
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.calEmpty}"
  id: ${calEmpty}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${fmt(cal.p_empty_psi)}
  optimistic: true
  restore_value: true
  entity_category: config

- platform: template
  name: "${names.calFull}"
  id: ${calFull}
  icon: "mdi:tune-vertical"
  min_value: 0
  max_value: 200
  step: 0.1
  initial_value: ${fmt(cal.p_full_psi)}
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

  rules: [
    {
      id: 'pressure-sensor-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => !n['remote'])
        .filter(n => !n['pin'])
        .map(n => ({
          message: `Pressure sensor "${n['name']}": no pin assigned. Standalone pressure sensors require an ADC pin.`,
          target: String(n['id']),
        })),
    },
    {
      id: 'pressure-sensor-undersized',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => typeof n['sensor_max_psi'] === 'number' && typeof n['tank_height_m'] === 'number')
        .flatMap(n => {
          const tankHeight = Number(n['tank_height_m']);
          const elevation = Number(n['elevation_m'] ?? 0);
          const sensorMax = Number(n['sensor_max_psi']);
          const cal = deriveTankCalibration(tankHeight, elevation);
          const recommended = recommendSensorMaxPsi(cal.p_full_psi);
          if (sensorMax < recommended) {
            return [{
              message: `Pressure sensor "${n['name']}": ${sensorMax} psi is below the recommended ${recommended} psi (1.5× full-tank pressure of ${cal.p_full_psi.toFixed(2)} psi). Consider a larger sensor for headroom.`,
              target: String(n['id']),
            }];
          }
          return [];
        }),
    },
    {
      id: 'pressure-sensor-elevated-low-resolution',
      severity: 'warning',
      evaluate: (nodes) => nodes
        .filter(n => typeof n['sensor_max_psi'] === 'number' && typeof n['tank_height_m'] === 'number')
        .flatMap(n => {
          const tankHeight = Number(n['tank_height_m']);
          const elevation = Number(n['elevation_m'] ?? 0);
          const sensorMax = Number(n['sensor_max_psi']);
          if (tankHeight <= 0 || elevation <= 0 || sensorMax <= 0) return [];

          const cal = deriveTankCalibration(tankHeight, elevation);
          const recommended = recommendSensorMaxPsi(cal.p_full_psi);
          if (sensorMax < recommended) return [];

          const spanPct = (cal.working_span_psi / sensorMax) * 100;
          if (spanPct < POOR_PRESSURE_SPAN_PCT) {
            return [{
              message: `Pressure sensor "${n['name']}": tank level uses only ${spanPct.toFixed(0)}% of the ${sensorMax} psi sensor range because empty pressure starts at ${cal.p_empty_psi.toFixed(2)} psi. Resolution may be poor on this elevated tank. Prefer reducing static head at the sensing point, using a lower-range protected sensor, or adding a pressure reducing/regulating arrangement that preserves the tank-level pressure swing.`,
              target: String(n['id']),
            }];
          }
          return [];
        }),
    },
  ],
};
