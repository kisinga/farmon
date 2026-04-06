import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#ea580c'; // orange
const S = 50;

// --- Schema ---

export const DosingPumpNodeSchema = z.object({
  kind: z.literal('dosing_pump'),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,
  flow_rate_ml_min: z.number().default(100),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});

export type DosingPumpNode = z.infer<typeof DosingPumpNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('dosing_pump', {
  kind: 'dosing_pump',
  label: 'Dosing Pump',
  color: COLOR,
  size: { width: S, height: S },
  role: 'passthrough',
  category: 'actuator',
  group: 'pump',
  experimental: true,
  schema: DosingPumpNodeSchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `Doser ${n}`, pin: '', flow_rate_ml_min: 100 }),

  renderSvg: (_data) => {
    const cx = S / 2, cy = S / 2, r = S / 2 - 5;
    // Circle with droplet icon — distinguishes from main pump's play triangle
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="M ${cx} ${cy - 10} Q ${cx + 6} ${cy - 2} ${cx + 6} ${cy + 2} A 6 6 0 0 1 ${cx - 6} ${cy + 2} Q ${cx - 6} ${cy - 2} ${cx} ${cy - 10}" fill="${COLOR}" fill-opacity="0.6"/>
    </svg>`;
  },

  legendSvg: `<svg width="20" height="16" viewBox="0 0 20 16"><circle cx="10" cy="8" r="6" fill="none" stroke="${COLOR}" stroke-width="2"/><path d="M10 4 Q13 7 13 9 A 3 3 0 0 1 7 9 Q7 7 10 4" fill="${COLOR}" opacity="0.6"/></svg>`,

  sidebarFields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'pin', label: 'Relay Pin', type: 'pin', placeholder: 'GPIO42' },
    { key: 'flow_rate_ml_min', label: 'Rate (mL/min)', type: 'number' },
  ],

  // No codegen — experimental, UI only.
});
