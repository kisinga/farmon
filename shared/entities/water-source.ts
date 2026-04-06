import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#0ea5e9'; // sky blue
const W = 120, H = 50;

const waterSource: NodeDescriptor = {
  kind: 'water_source',
  label: 'Water Source',
  color: COLOR,
  size: { width: W, height: H },
  role: 'terminal',
  routeSource: true,
  category: 'source',
  helpUrl: 'docs/installation-guidelines.md#pressure-sensors',
  defaultPorts: [
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Source ${n}` }),
  renderSvg: (name) => {
    const icx = 20, icy = H / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="6" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2"/>
      <path d="M ${icx - 8} ${icy - 8} L ${icx - 8} ${icy + 8} L ${icx + 8} ${icy}" fill="${COLOR}" fill-opacity="0.25" stroke="${COLOR}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M ${icx + 8} ${icy} L ${icx + 16} ${icy}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <text x="42" y="${H / 2}" text-anchor="start" dominant-baseline="middle" font-size="12" font-family="ui-monospace, monospace" font-weight="500" fill="${UI_COLORS.text}">${escXml(name)}</text>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="${COLOR}" stroke-width="1.5"/><path d="M5 4 L5 12 L13 8 Z" fill="${COLOR}" opacity="0.25" stroke="${COLOR}" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 8 L17 8" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
    { key: 'pressure_pin', label: 'Pressure Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],
};

NODE_REGISTRY.set('water_source', waterSource);
