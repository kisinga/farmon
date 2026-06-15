import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { GpioPin, ComponentId, EntityName, PortSchema, PositionSchema, escXml } from '../schemas';
import { AnchorIdSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { SYMBOL } from '../symbol-style';
import { waterSourcePressureId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';

const COLOR = '#0ea5e9'; // sky blue
const W = 120, H = 50;

// --- Schema ---

export const WaterSourceNodeSchema = z.object({
  kind: z.literal('water_source'),
  id: ComponentId,
  name: EntityName,
  /** When true (default), the source is pressurised and requires a downstream
   *  isolation valve for positive shut-off.  When false (e.g. borehole, sump),
   *  the pump itself provides isolation and no valve is required. */
  pressurized: z.boolean().default(true).optional(),
  pressure_pin: GpioPin.optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  anchorId: AnchorIdSchema,
});

export type WaterSourceNode = z.infer<typeof WaterSourceNodeSchema>;

// Single source of truth for the water source's emitted entity name. The
// pressure entity is conditional on `pressure_pin`.
const haNames = (node: WaterSourceNode) => ({
  pressure: `${node.name} Pressure`,
});

// --- Descriptor ---

export const waterSourceDescriptor: NodeDescriptor = {
  kind: 'water_source',
  label: 'Water Source',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation/power-and-wiring.md',
  schema: WaterSourceNodeSchema,
  defaultPorts: [
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Source ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Source';
    const icy = H / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect data-part="body" x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${SYMBOL.radius}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="${SYMBOL.stroke}"/>
      <path d="M 14 ${icy - 9} Q 25 ${icy} 14 ${icy + 9}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 21 ${icy - 7} Q 30 ${icy} 21 ${icy + 7}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
      <text x="40" y="${icy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  // Live map: pressure readout (when instrumented); accent on the body.
  live: { value: true },

  sidebarFields: [
    {
      key: 'pressurized',
      label: 'Pressurised supply',
      type: 'toggle',
      hint: 'Mains water or elevated tank — requires a downstream isolation valve. Disable for boreholes or sumps where the pump itself stops flow.',
    },
    { key: 'pressure_pin', label: 'Pressure Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],

  // --- Codegen ---

  codegen: {
    sensors: (node: WaterSourceNode, _idx, ctx) => {
      if (!node.pressure_pin) return '';
      const sId = waterSourcePressureId(node);
      const header = resolveComponentHeader(ctx, node.pressure_pin, { purpose: 'adc' });
      return `\
${header}
  id: ${sId}
  name: "${haNames(node).pressure}"
  unit_of_measurement: "bar"
  icon: "mdi:gauge"
  update_interval: \${update_interval}
  accuracy_decimals: 2`;
    },

    substitutions: () => [],
  },

  // --- Validation ---

  routeRules: [{
    id: 'source-downstream-valve',
    severity: 'error',
    evaluate: (node, route, graph) => {
      if (!(node as WaterSourceNode).pressurized) return null;
      const idx = route.nodeSequence.indexOf(node.id);
      const downstream = route.nodeSequence.slice(idx + 1);
      const searchRange = downstream.length > 0
        ? downstream
        : graph.outNeighbors(node.id);
      if (searchRange.some(id => graph.getNodeAttribute(id, 'isValve'))) return null;
      return {
        severity: 'error',
        message: `Route "${route.key}": Isolation valve required downstream of pressurised water source`,
        target: route.key,
        ruleId: 'source-downstream-valve',
      };
    },
  }],

  rules: [{
    id: 'water-source-pressure-warning',
    severity: 'warning',
    evaluate: (sources) => sources
      .filter(ws => !(ws as Record<string, unknown>)['pressure_pin'])
      .map(ws => ({
        message: `Water source "${ws.id}": no pressure sensor configured. Incoming supply pressure will not be monitored.`,
        target: ws.id,
      })),
  }],
};
