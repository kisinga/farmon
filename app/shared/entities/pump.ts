import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

const COLOR = '#dc2626'; // red
const S = 60;

const pump: NodeDescriptor = {
  kind: 'pump',
  label: 'Pump',
  color: COLOR,
  size: { width: S, height: S },
  singleton: true,
  role: 'passthrough',
  defaultPorts: [
    { id: 'in', label: 'Inlet', direction: 'inlet' },
    { id: 'out', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: () => ({ pin: '' }),
  renderSvg: () => {
    const cx = S / 2, cy = S / 2, r = S / 2 - 3;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <polygon points="${cx - 10},${cy - 12} ${cx - 10},${cy + 12} ${cx + 14},${cy}" fill="${COLOR}" opacity="0.85"/>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><circle cx="10" cy="8" r="7" fill="none" stroke="${COLOR}" stroke-width="2"/><polygon points="7,3 7,13 15,8" fill="${COLOR}" opacity="0.85"/></svg>`,
  sidebarFields: [
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42' },
  ],
};

NODE_REGISTRY.set('pump', pump);
