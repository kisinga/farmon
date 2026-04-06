import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#6366f1'; // indigo
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
  renderSvg: (name) => {
    const icx = 20, icy = H / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="6" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2" stroke-dasharray="6,3"/>
      <path d="M ${icx} ${icy - 6} L ${icx} ${icy + 2} M ${icx - 8} ${icy + 8} Q ${icx} ${icy + 2} ${icx + 8} ${icy + 8} M ${icx - 12} ${icy + 14} Q ${icx} ${icy + 4} ${icx + 12} ${icy + 14}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <text x="38" y="${H / 2}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="500" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-dasharray="3,2"/><path d="M10 4 L10 7 M6 10 Q10 6 14 10 M4 13 Q10 7 16 13" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
  ],
};

NODE_REGISTRY.set('endpoint', endpoint);
