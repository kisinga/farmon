import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, EntityName, PortSchema, PositionSchema, escXml } from '../schemas';
import { UI_COLORS } from '../colors';
import { HaNodeFields } from '../ha';

const COLOR = '#8b5cf6'; // violet
const CONNECTED_COLOR = '#0891b2'; // cyan for incoming
const W = 120, H_BASE = 50, H_CONNECTED = 66;

// --- Schema ---

export const InterconnectNodeSchema = z.object({
  kind: z.literal('interconnect'),
  id: ComponentId,
  name: EntityName,
  notes: z.string().optional(),
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
  ...HaNodeFields,
});

export type InterconnectNode = z.infer<typeof InterconnectNodeSchema>;

// --- Descriptor ---

export const interconnectDescriptor: NodeDescriptor = {
  kind: 'interconnect',
  label: 'Interconnect',
  color: COLOR,
  size: { width: W, height: H_BASE },
  role: 'terminal',
  routeSource: true,
  category: 'boundary',
  schema: InterconnectNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  portLayout: { inlet: { y: 25 }, outlet: { y: 25 } },
  defaultData: (n) => ({ name: `Interconnect ${n}` }),

  renderSvg: (data) => {
    const name = data['name'] ?? 'Interconnect';
    const connLabel = data['_connectionLabel'] as string | undefined;
    const connDir = data['_connectionDir'] as 'out' | 'in' | undefined;
    const H = connLabel ? H_CONNECTED : H_BASE;
    const cy = H_BASE / 2;
    const labelColor = connDir === 'in' ? CONNECTED_COLOR : COLOR;

    let connSvg = '';
    if (connLabel) {
      const arrow = connDir === 'out' ? '\u2192' : '\u2190';
      connSvg = `<text x="${W / 2}" y="${H_BASE + 2}" text-anchor="middle" dominant-baseline="hanging" font-size="9" font-family="ui-sans-serif, sans-serif" font-weight="600" fill="${labelColor}">${arrow} ${escXml(connLabel)}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H_BASE - 3}" rx="8" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2" stroke-dasharray="6,3"/>
      <path d="M 16 ${cy - 8} L 24 ${cy} L 16 ${cy + 8}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 32 ${cy - 8} L 24 ${cy} L 32 ${cy + 8}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="42" y="${cy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
      ${connSvg}
    </svg>`;
  },

  sidebarFields: [
    { key: 'notes', label: 'Notes', type: 'text', placeholder: '50m PVC to pump house' },
  ],

  constraints: [],

  // Interconnect has no codegen — it's a logical boundary marker with no hardware.
};
