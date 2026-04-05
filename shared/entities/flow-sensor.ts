import { INLINE_REGISTRY, type InlineComponentDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR = '#16a34a'; // green
const W = 50, H = 36;

const flowSensor: InlineComponentDescriptor = {
  kind: 'flow_sensor',
  label: 'Flow Sensor',
  labelPrefix: 'F',
  color: COLOR,
  size: { width: W, height: H },
  defaultData: (n) => ({ name: `Flow ${n}`, pin: '', flow_cal: 450 }),
  renderSvg: (shortLabel) => {
    const cx = W / 2, cy = H / 2, r = 13;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <path d="M 0 ${cy} L ${cx - r} ${cy}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round"/>
      <path d="M ${cx + r} ${cy} L ${W} ${cy} M ${W - 5} ${cy - 4} L ${W} ${cy} L ${W - 5} ${cy + 4}" fill="none" stroke="${COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="14" font-family="ui-monospace, monospace" font-weight="800" fill="${COLOR}">F</text>
      <text x="${cx}" y="${cy + r + 11}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-family="ui-monospace, monospace" font-weight="700" fill="${COLOR}">${escXml(shortLabel)}</text>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><circle cx="10" cy="8" r="6" fill="none" stroke="${COLOR}" stroke-width="2"/><text x="10" y="8" text-anchor="middle" dominant-baseline="central" fill="${COLOR}" font-size="9" font-weight="800" font-family="ui-monospace, monospace">F</text><path d="M0 8 L4 8 M16 8 L20 8 M17 6 L20 8 L17 10" fill="none" stroke="${COLOR}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO47' },
    { key: 'flow_cal', label: 'Cal (pulses/L)', type: 'number' },
  ],
};

INLINE_REGISTRY.set('flow_sensor', flowSensor);
