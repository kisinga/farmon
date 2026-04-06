import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#d97706'; // amber — warm complement to source's blue
const W = 120, H = 50;

const endpoint: NodeDescriptor = {
  kind: 'endpoint',
  label: 'Endpoint',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  category: 'destination',
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
  ],
  defaultData: (n) => ({ name: `Endpoint ${n}` }),
  renderSvg: (data) => {
    const name = data['name'] ?? 'Endpoint';
    const icy = H / 2;
    // Soft chevrons pointing left — flow enters this node (mirror of water source)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2" />
      <path d="M 28 ${icy - 9} Q 17 ${icy} 28 ${icy + 9}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 21 ${icy - 7} Q 12 ${icy} 21 ${icy + 7}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
      <text x="38" y="${icy}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="${COLOR}" stroke-width="1.5" /><path d="M14 4 Q8 8 14 12" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/><path d="M10 5 Q5 8 10 11" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
  ],
};

NODE_REGISTRY.set('endpoint', endpoint);
