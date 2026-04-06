import { NODE_REGISTRY, type NodeDescriptor } from '../entity-registry';
import { UI_COLORS } from '../colors';

const COLOR = '#16a34a'; // green
const W = 50, H = 36;

const flowSensor: NodeDescriptor = {
  kind: 'flow_sensor',
  label: 'Flow Sensor',
  color: COLOR,
  size: { width: W, height: H },
  role: 'passthrough',
  category: 'sensor',
  helpUrl: 'docs/installation-guidelines.md#flow-sensors',
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Flow ${n}`, pin: '', flow_cal: 450 }),
  renderSvg: (_data) => {
    const cx = W / 2, cy = H / 2, r = 14;
    // Turbine/propeller blades — rotated 120° apart
    const blade = (angle: number) => {
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      // Blade: teardrop from center outward
      const tip = 10;
      const spread = 4;
      const tx = cx + tip * cos, ty = cy + tip * sin;
      const lx = cx + spread * Math.cos(rad + 1.2), ly = cy + spread * Math.sin(rad + 1.2);
      const rx = cx + spread * Math.cos(rad - 1.2), ry = cy + spread * Math.sin(rad - 1.2);
      return `M ${cx} ${cy} Q ${lx} ${ly} ${tx} ${ty} Q ${rx} ${ry} ${cx} ${cy}`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="${blade(0)} ${blade(120)} ${blade(240)}" fill="${COLOR}" fill-opacity="0.7"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="${COLOR}"/>
    </svg>`;
  },
  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><circle cx="10" cy="8" r="6" fill="none" stroke="${COLOR}" stroke-width="2"/><circle cx="10" cy="8" r="1.5" fill="${COLOR}"/><path d="M10 8 Q12 5 15 8 Q12 11 10 8 M10 8 Q7 5 7 2 Q11 5 10 8 M10 8 Q7 11 7 14 Q11 11 10 8" fill="${COLOR}" opacity="0.7"/></svg>`,
  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO47', pinCap: 'pulse_counter' },
    { key: 'flow_cal', label: 'Cal (pulses/L)', type: 'number' },
  ],
};

NODE_REGISTRY.set('flow_sensor', flowSensor);
