import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import type { FlowConstraint } from '../graph/constraints';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#d97706'; // amber
const W = 120, H = 50;

// --- Schema ---

export const EndpointNodeSchema = z.object({
  kind: z.literal('endpoint'),
  id: ComponentId,
  name: z.string().min(1),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type EndpointNode = z.infer<typeof EndpointNodeSchema>;

// --- Descriptor ---

export const endpointDescriptor: NodeDescriptor = {
  kind: 'endpoint',
  label: 'Endpoint',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  category: 'destination',
  schema: EndpointNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
  ],
  defaultData: (n) => ({ name: `Endpoint ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Endpoint';
    const icy = H / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2"/>
      <path d="M 28 ${icy - 9} Q 17 ${icy} 28 ${icy + 9}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 21 ${icy - 7} Q 12 ${icy} 21 ${icy + 7}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
      <text x="38" y="${icy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  sidebarFields: [],

  constraints: [
    { type: 'presence', id: 'endpoint-flow-sensor', requiredKind: 'flow_sensor',
      position: 'upstream', baseSeverity: 'warning',
      description: 'Flow sensor recommended for usage tracking' },
  ] satisfies FlowConstraint[],

  // Endpoint has no codegen — it's a terminal node with no hardware.
};
