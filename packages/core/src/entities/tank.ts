import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, EntityName, PortSchema, PositionSchema, escXml } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';
import { HaNodeFields } from '../ha';
import { homeassistantSensorImport } from '../remote-proxy';

const COLOR = '#14b8a6'; // teal
const W = 120, H = 70;

// --- Schema ---

export const TankNodeSchema = z.object({
  kind: z.literal('tank'),
  id: ComponentId,
  name: EntityName,
  /**
   * Vertical span of water column inside the tank, metres. Drives
   * pressure-sensor calibration when a downstream pressure sensor is used
   * as the tank's level source.
   */
  height_m: z.number().positive().optional(),
  /** Tank usable capacity in litres. Drives volume readouts. */
  capacity_l: z.number().positive().optional(),
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
    { key: 'height_m', label: 'Tank height (m)', type: 'number', hint: 'Drives pressure-sensor calibration when a downstream pressure sensor reads this tank.' },
    { key: 'capacity_l', label: 'Tank capacity (L)', type: 'number' },
  ],

  codegen: {
    remoteProxy: (node, haEntityId) => [
      { section: 'sensor', yaml: homeassistantSensorImport(node.id, haEntityId) },
    ],
  },

  constraints: [
    { type: 'presence', id: 'tank-downstream-sensor',
      requiredKind: ['level_sensor', 'pressure_sensor'],
      position: 'downstream', baseSeverity: 'warning',
      description: 'Level or pressure sensor recommended after tank for pre-flight checks and automated refill' },
  ] satisfies FlowConstraint[],
};
