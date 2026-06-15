import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, EntityName, PortSchema, PositionSchema, escXml } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { SYMBOL } from '../symbol-style';
import { udpSensorImport } from '../remote-proxy';
import {
  PressureSensorConfigSchema,
  emitPressureSensorYaml,
  emitPressureCalNumbers,
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
  /** When true, this tank has intrinsic pressure-based level monitoring. */
  level_monitored: z.boolean().default(false),
  /** Intrinsic pressure-sensor configuration for tank level monitoring. */
  pressure_pin: PressureSensorConfigSchema.shape.pin.optional(),
  pressure_elevation_m: PressureSensorConfigSchema.shape.elevation_m.optional(),
  pressure_sensor_max_psi: PressureSensorConfigSchema.shape.sensor_max_psi.optional(),
  pressure_pump_rated: PressureSensorConfigSchema.shape.pump_rated.optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
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
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  portLayout: { inlet: { y: 15 }, outlet: { y: 55 } },
  defaultData: (n) => ({ name: `Tank ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Tank';
    // `data-part=fill` (the water) scales from the bottom by `--fill` (level %);
    // `data-part=body` (the shell) takes the state accent. The level readout is
    // overlaid by the canvas (live.value).
    // `data-part=fill` (water) fills most of the interior and scales from the
    // bottom by the live level; `data-part=body` is the cylinder + rim cap.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect data-part="fill" x="6" y="14" width="${W - 12}" height="${H - 17}" rx="3" fill="${UI_COLORS.water}" opacity="0.5"/>
      <path data-part="body" d="M 4 10 L 4 ${H - 4} Q 4 ${H} 10 ${H} L ${W - 10} ${H} Q ${W - 4} ${H} ${W - 4} ${H - 4} L ${W - 4} 10" fill="none" stroke="${COLOR}" stroke-width="${SYMBOL.stroke}" stroke-linecap="round" stroke-linejoin="round"/>
      <ellipse cx="${W / 2}" cy="10" rx="${W / 2 - 4}" ry="5" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="${SYMBOL.stroke}"/>
      <text x="${W / 2}" y="26" text-anchor="middle" dominant-baseline="middle" font-size="${SYMBOL.font.name}" font-family="${SYMBOL.font.family}" font-weight="${SYMBOL.font.weight}" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  // Live map: water rises to the reported level; level % readout below.
  live: { fill: true, value: true },

  sidebarFields: [
    { key: 'height_m', label: 'Tank height (m)', type: 'number', hint: 'Drives pressure-sensor calibration when the tank has an intrinsic pressure sensor.' },
    { key: 'capacity_l', label: 'Tank capacity (L)', type: 'number' },
    { key: 'level_monitored', label: 'Tank level monitored', type: 'toggle', hint: 'Enable intrinsic pressure-sensor based level monitoring for this tank.' },
    { key: 'pressure_pin', label: 'Pressure pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc', hint: 'ADC pin for the tank-mounted pressure sensor. Required when level monitoring is enabled.' },
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

    remoteProxy: (node) => [
      { section: 'sensor', yaml: udpSensorImport(node.id) },
    ],
  },

  rules: [
    {
      id: 'tank-pressure-pin-required',
      severity: 'error',
      evaluate: (nodes) => nodes
        .filter(n => {
          const data = n as Record<string, unknown>;
          return data['kind'] === 'tank' && data['level_monitored'] === true && !data['pressure_pin'];
        })
        .map(n => ({
          message: `Tank "${n.name}": level monitoring is enabled but no pressure pin assigned. Set a pin or disable level monitoring.`,
          target: n.id,
        })),
    },
    {
      id: 'tank-pressure-undersized',
      severity: 'warning',
      evaluate: (nodes) => {
        const candidates = nodes
          .filter(n => n.kind === 'tank' && (n as TankNode).level_monitored)
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
          .filter(n => n.kind === 'tank' && (n as TankNode).level_monitored)
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
