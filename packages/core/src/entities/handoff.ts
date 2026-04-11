import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, PortSchema, PositionSchema, escXml } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#8b5cf6'; // violet
const W = 120, H = 50;

// --- Schema ---

export const HandoffNodeSchema = z.object({
  kind: z.literal('handoff'),
  id: ComponentId,
  name: z.string().min(1),
  notes: z.string().optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type HandoffNode = z.infer<typeof HandoffNodeSchema>;

// --- Descriptor ---

export const handoffDescriptor: NodeDescriptor = {
  kind: 'handoff',
  label: 'Handoff',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'boundary',
  schema: HandoffNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  portLayout: { inlet: { y: 25 }, outlet: { y: 25 } },
  defaultData: (n) => ({ name: `Handoff ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Handoff';
    const cy = H / 2;
    // Bridge/connector motif: two arrows pointing inward with a gap
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2" stroke-dasharray="6,3"/>
      <path d="M 16 ${cy - 8} L 24 ${cy} L 16 ${cy + 8}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 32 ${cy - 8} L 24 ${cy} L 32 ${cy + 8}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="42" y="${cy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },

  sidebarFields: [
    { key: 'notes', label: 'Notes', type: 'text', placeholder: '50m PVC to pump house' },
  ],

  constraints: [],

  // Handoff has no codegen — it's a logical boundary marker with no hardware.
};
