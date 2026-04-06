import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';

const COLOR = '#e11d48'; // rose
const W = 50, H = 36;

const valve: NodeDescriptor = {
  kind: 'valve',
  label: 'Valve',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'actuator',
  helpUrl: 'docs/installation-guidelines.md#valves',
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Valve ${n}`, open_pin: '', close_pin: '' }),
  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2;
    const hx = 17, hy = 12;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <path d="M ${cx - hx} ${cy - hy} L ${cx} ${cy} L ${cx - hx} ${cy + hy} Z" fill="${COLOR}" fill-opacity="0.15" stroke="${COLOR}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M ${cx + hx} ${cy - hy} L ${cx} ${cy} L ${cx + hx} ${cy + hy} Z" fill="${COLOR}" fill-opacity="0.15" stroke="${COLOR}" stroke-width="2.5" stroke-linejoin="round"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - hy - 2}" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${cx - 6}" y1="${cy - hy - 2}" x2="${cx + 6}" y2="${cy - hy - 2}" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><path d="M2 3 L10 8 L2 13 Z" fill="${COLOR}" opacity="0.15" stroke="${COLOR}" stroke-width="2" stroke-linejoin="round"/><path d="M18 3 L10 8 L18 13 Z" fill="${COLOR}" opacity="0.15" stroke="${COLOR}" stroke-width="2" stroke-linejoin="round"/><line x1="10" y1="8" x2="10" y2="1" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/><line x1="7" y1="1" x2="13" y2="1" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'open_pin', label: 'Open Pin', type: 'pin', placeholder: 'GPIO4' },
    { key: 'close_pin', label: 'Close Pin', type: 'pin', placeholder: 'GPIO5' },
  ],
};

NODE_REGISTRY.set('valve', valve);
