import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, EntityName, PortSchema, PositionSchema, escXml } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { HaNodeFields, deriveHaEntityId } from '../ha';
import { homeassistantSensorImport } from '../remote-proxy';
import {
  PressureSensorConfigSchema,
  emitPressureSensorYaml,
  emitPressureCalNumbers,
  pressureSensorHaNames,
  evaluatePressureSensorUndersized,
  evaluatePressureSensorElevatedLowResolution,
} from '../pressure-sensor-shared';

const COLOR = '#14b8a6'; // teal
const W = 120, H = 70;

// --- Schema ---

export const TankNodeSchema = z.object({
  kind: z.literal('tank'),
  id: ComponentId,
  name: EntityName,
  /**
   * Vertical span of water column inside the tank, metres. Drives
   * pressure-sensor calibration when the tank has an intrinsic pressure sensor.
   */
  height_m: z.number().positive().optional(),
  /** Tank usable capacity in litres. Drives volume readouts. */
  capacity_l: z.number().positive().optional(),
  /** Intrinsic pressure-sensor configuration for tank level monitoring. */
  pressure_pin: PressureSensorConfigSchema.shape.pin.optional(),
  pressure_elevation_m: PressureSensorConfigSchema.shape.elevation_m.optional(),
  pressure_sensor_max_psi: PressureSensorConfigSchema.shape.sensor_max_psi.optional(),
  pressure_pump_rated: PressureSensorConfigSchema.shape.pump_rated.optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
  anchorId: AnchorIdSchema,
});

export type TankNode = z.infer<typeof TankNodeSchema>;

// --- Descriptor ---

export const tankDescriptor: NodeDescriptor = {
  kind: 'tank',
  label: 'Tank',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  schema: TankNodeSchema,
  haDomain: 'sensor',
  defaultHaActions: [
    { id: 'more-info', label: 'More info' },
  ],
  slots: {
    label: { x: W / 2, y: H + 14, textAnchor: 'middle', cls: 'label-primary' },
    value: { x: W / 2, y: H + 28, textAnchor: 'middle', cls: 'label-secondary' },
  },
  defaultBinds: { value: 'state|format:percent' },
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  portLayout: { inlet: { y: 15 }, outlet: { y: 55 } },
  defaultData: (n) => ({ name: `Tank ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Tank';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="5" y="30" width="${W - 10}" height="${H - 33}" rx="2" fill="${UI_COLORS.water}" opacity="0.5"/>
      <path d="M 3 8 L 3 ${H - 3} Q 3 ${H} 9 ${H} L ${W - 9} ${H} Q ${W - 3} ${H} ${W - 3} ${H - 3} L ${W - 3} 8" fill="none" stroke="${COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${W / 2}" y="20" text-anchor="middle" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  sidebarFields: [
    { key: 'height_m', label: 'Tank height (m)', type: 'number', hint: 'Drives pressure-sensor calibration when the tank has an intrinsic pressure sensor.' },
    { key: 'capacity_l', label: 'Tank capacity (L)', type: 'number' },
    { key: 'pressure_pin', label: 'Pressure pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc', hint: 'ADC pin for an intrinsic tank-mounted pressure sensor. Leave blank if using a separate level sensor or no level monitoring.' },
    { key: 'pressure_elevation_m', label: 'Sensor drop below tank (m)', type: 'number', hint: 'Vertical drop from tank outlet down to sensor. Stays full of water — shifts the empty-tank reading.' },
    { key: 'pressure_sensor_max_psi', label: 'Sensor max (psi)', type: 'number', hint: 'Datasheet full-scale value, e.g. 5 / 10 / 15 / 30 psi.' },
    {
      key: 'pressure_pump_rated',
      label: 'Reading reliable while pump runs',
      type: 'toggle',
      hint: 'Tank-mounted sensors read static head and stay reliable during pump operation.',
    },
  ],

  codegen: {
    sensors: (node: TankNode, _idx, ctx) => {
      if (!node.pressure_pin) return '';
      return emitPressureSensorYaml(
        { id: node.id, name: node.name, pin: node.pressure_pin },
        ctx,
      );
    },

    extraComponents: (node: TankNode): Record<string, string> => {
      if (!node.pressure_pin || !node.pressure_sensor_max_psi) return {};
      return emitPressureCalNumbers(
        {
          id: node.id,
          name: node.name,
          sensor_max_psi: node.pressure_sensor_max_psi,
          elevation_m: node.pressure_elevation_m,
        },
        node.height_m,
      );
    },

    substitutions: () => [],

    haEntityIds: (node: TankNode, device) => {
      // The tank only has a canonical HA entity when it has an intrinsic
      // pressure sensor. Otherwise its level comes from a downstream
      // level_sensor and is resolved via cross-reference in ha-meta.ts.
      if (!node.pressure_pin) return {};
      const n = pressureSensorHaNames(node);
      return {
        level: deriveHaEntityId('sensor', device, n.level),
        pressure: deriveHaEntityId('sensor', device, n.pressure),
        rangeMin: deriveHaEntityId('number', device, n.rangeMin),
        rangeMax: deriveHaEntityId('number', device, n.rangeMax),
        calEmpty: deriveHaEntityId('number', device, n.calEmpty),
        calFull: deriveHaEntityId('number', device, n.calFull),
      };
    },

    remoteProxy: (node, haEntityId) => [
      { section: 'sensor', yaml: homeassistantSensorImport(node.id, haEntityId) },
    ],
  },

  routeRules: [{
    id: 'tank-downstream-sensor',
    severity: 'warning',
    evaluate: (node, route, graph) => {
      if ((node as TankNode).pressure_pin) return null;
      const idx = route.nodeSequence.indexOf(node.id);
      const downstream = route.nodeSequence.slice(idx + 1);
      const searchRange = downstream.length > 0
        ? downstream
        : graph.outNeighbors(node.id);
      if (searchRange.some(id => graph.getNodeAttribute(id, 'isLevelSensor'))) return null;
      return {
        severity: 'warning',
        message: `Route "${route.key}": Level sensor recommended after tank for pre-flight checks and automated refill`,
        target: route.key,
        ruleId: 'tank-downstream-sensor',
      };
    },
  }],

  rules: [
    {
      id: 'tank-pressure-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => {
          const data = n as Record<string, unknown>;
          return data['kind'] === 'tank' && data['pressure_sensor_max_psi'] != null && !data['pressure_pin'];
        })
        .map(n => ({
          message: `Tank "${n.name}": pressure sensor max psi is set but no pin assigned. Set a pin or clear the pressure sensor config.`,
          target: n.id,
        })),
    },
    {
      id: 'tank-pressure-undersized',
      severity: 'warning',
      evaluate: (nodes) => {
        const candidates = nodes
          .filter(n => n.kind === 'tank')
          .map(n => ({
            id: n.id,
            name: n.name,
            sensor_max_psi: (n as TankNode).pressure_sensor_max_psi,
            elevation_m: (n as TankNode).pressure_elevation_m,
            tank_height_m: (n as TankNode).height_m,
          }))
          .filter((n): n is typeof n & { sensor_max_psi: number; tank_height_m: number } =>
            typeof n.sensor_max_psi === 'number' && typeof n.tank_height_m === 'number');
        return evaluatePressureSensorUndersized(candidates);
      },
    },
    {
      id: 'tank-pressure-elevated-low-resolution',
      severity: 'warning',
      evaluate: (nodes) => {
        const candidates = nodes
          .filter(n => n.kind === 'tank')
          .map(n => ({
            id: n.id,
            name: n.name,
            sensor_max_psi: (n as TankNode).pressure_sensor_max_psi,
            elevation_m: (n as TankNode).pressure_elevation_m,
            tank_height_m: (n as TankNode).height_m,
          }))
          .filter((n): n is typeof n & { sensor_max_psi: number; tank_height_m: number } =>
            typeof n.sensor_max_psi === 'number' && typeof n.tank_height_m === 'number');
        return evaluatePressureSensorElevatedLowResolution(candidates);
      },
    },
  ],
};
