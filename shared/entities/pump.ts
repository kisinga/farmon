import { z } from 'zod';
import { NODE_REGISTRY } from '../entity-registry';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#dc2626'; // red
const S = 60;

// --- Schema ---

export const PumpNodeSchema = z.object({
  kind: z.literal('pump'),
  id: ComponentId,
  pin: GpioPin,
  ports: z
    .array(PortSchema)
    .length(2)
    .refine(
      (ports) =>
        ports.filter((p) => p.direction === 'inlet').length === 1 &&
        ports.filter((p) => p.direction === 'outlet').length === 1,
      { message: 'Pump must have exactly one inlet and one outlet port' },
    ),
  position: PositionSchema,
});

export type PumpNode = z.infer<typeof PumpNodeSchema>;

// --- Register ---

NODE_REGISTRY.set('pump', {
  kind: 'pump',
  label: 'Pump',
  color: COLOR,
  size: { width: S, height: S },
  singleton: true,
  role: 'passthrough',
  category: 'actuator',
  group: 'pump',
  schema: PumpNodeSchema,
  defaultPorts: [
    { id: 'in', label: 'Inlet', direction: 'inlet' },
    { id: 'out', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: () => ({ pin: '' }),

  renderSvg: (_data) => {
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

  // --- Codegen ---

  codegen: {
    hardware: (node) => `\
  # --- Pump relay ------------------------------------------------------------
  - platform: gpio
    pin:
      number: \${pin_pump_relay}
      inverted: true
    id: pump_relay
    name: "Pump Relay"
    icon: "mdi:water-pump"
    internal: true
    restore_mode: ALWAYS_OFF
    on_turn_on:
      - if:
          condition:
            lambda: 'return id(system_state) != 2;'
          then:
            - switch.turn_off: pump_relay
            - logger.log: {level: WARN, format: "BLOCKED: pump only runs in RUNNING state"}`,

    substitutions: (node) => [`pin_pump_relay: "${node['pin']}"`],
  },
});
