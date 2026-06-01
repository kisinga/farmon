import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, EntityName, PortSchema, PositionSchema } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { HaNodeFields, deriveHaEntityId } from '../ha';
import { homeassistantSensorImport } from '../remote-proxy';
import {
  PressureSensorConfigSchema,
  emitPressureSensorYaml,
  emitPressureCalNumbers,
  pressureSensorHaNames,
} from '../pressure-sensor-shared';

const COLOR = '#8b5cf6'; // violet
const W = 50, H = 36;

// --- Schema ---
//
// Pressure sensors used for plain line-pressure monitoring (no upstream tank)
// carry only the shared pressure config. Tank-mounted pressure monitoring is
// now an intrinsic property of the tank node, not a separate node.

export const PressureSensorNodeSchema = z.object({
  kind: z.literal('pressure_sensor'),
  id: ComponentId,
  name: EntityName,
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  anchorId: AnchorIdSchema,
  ...PressureSensorConfigSchema.shape,
});

export type PressureSensorNode = z.infer<typeof PressureSensorNodeSchema>;

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
    { key: 'elevation_m', label: 'Sensor drop below tank (m)', type: 'number', hint: 'Vertical drop from tank outlet down to sensor. Stays full of water — shifts the empty-tank reading. Only relevant when this sensor is used for tank level monitoring (now intrinsic on the tank node).' },
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
      return emitPressureSensorYaml(node, ctx);
    },

    extraComponents: (node: PressureSensorNode): Record<string, string> => {
      // Inline pressure sensors have no upstream tank in the new model, so
      // calibration seeds 0 → sensor_max_psi (line-pressure mode).
      return emitPressureCalNumbers(node, undefined);
    },

    substitutions: () => [],

    haEntityIds: (node: PressureSensorNode, device) => {
      const n = pressureSensorHaNames(node);
      return {
        pressure: deriveHaEntityId('sensor', device, n.pressure),
        level:    deriveHaEntityId('sensor', device, n.level),
        rangeMin: deriveHaEntityId('number', device, n.rangeMin),
        rangeMax: deriveHaEntityId('number', device, n.rangeMax),
        calEmpty: deriveHaEntityId('number', device, n.calEmpty),
        calFull:  deriveHaEntityId('number', device, n.calFull),
      };
    },

    remoteProxy: (node, haEntityId) => [
      { section: 'sensor', yaml: homeassistantSensorImport(node.id, haEntityId) },
    ],
  },

  constraints: [] satisfies FlowConstraint[],

  // --- Validation ---

  rules: [
    {
      id: 'pressure-sensor-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => n.kind === 'pressure_sensor' && !(n as Record<string, unknown>)['pin'])
        .map(n => ({
          message: `Pressure sensor "${n.name}": no pin assigned. Standalone pressure sensors require an ADC pin.`,
          target: n.id,
        })),
    },
    // Tank-dependent validation (undersized, elevated-low-resolution) has moved
    // to the tank descriptor because tank-mounted pressure monitoring is now
    // intrinsic. Inline line-pressure sensors carry no tank geometry context.
  ],
};
