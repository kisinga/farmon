import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#14b8a6'; // teal
const W = 120, H = 70;

const tank: NodeDescriptor = {
  kind: 'tank',
  label: 'Tank',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation-guidelines.md#tank-level-sensors',
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Tank ${n}`, level_pin: '' }),
  renderSvg: (data) => {
    const name = data['name'] ?? 'Tank';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="5" y="30" width="${W - 10}" height="${H - 33}" rx="2" fill="${UI_COLORS.water}" opacity="0.5"/>
      <path d="M 3 8 L 3 ${H - 3} Q 3 ${H} 9 ${H} L ${W - 9} ${H} Q ${W - 3} ${H} ${W - 3} ${H - 3} L ${W - 3} 8" fill="none" stroke="${COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${W / 2}" y="20" text-anchor="middle" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="600" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><path d="M1 2 L1 14 Q1 15 3 15 L17 15 Q19 15 19 14 L19 2" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/><rect x="3" y="7" width="14" height="7" rx="1" fill="#bae6fd" opacity="0.5"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
    { key: 'level_pin', label: 'Level Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],
};

NODE_REGISTRY.set('tank', tank);
