import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';

const COLOR = '#7c3aed'; // violet
const S = 60;

// --- Schema ---

export const VfdNodeSchema = z.object({
  kind: z.literal('vfd'),
  id: ComponentId,
  name: z.string().default('VFD Pump'),
  bus: ComponentId,
  modbus_address: z.number().min(1).max(247),
  start_register: z.number().default(0x0001),
  power_register: z.number().optional(),
  frequency_register: z.number().optional(),
  fault_register: z.number().optional(),
  disabled: z.boolean().optional(),
  ports: z
    .array(PortSchema)
    .length(2)
    .refine(
      (ports) =>
        ports.filter((p) => p.direction === 'inlet').length === 1 &&
        ports.filter((p) => p.direction === 'outlet').length === 1,
      { message: 'VFD must have exactly one inlet and one outlet port' },
    ),
  position: PositionSchema,
});

export type VfdNode = z.infer<typeof VfdNodeSchema>;

// --- Descriptor ---

export const vfdDescriptor: NodeDescriptor = {
  kind: 'vfd',
  label: 'VFD Inverter',
  isPump: true,
  conflictClass: 'actuator',
  color: COLOR,
  size: { width: S, height: S },
  role: 'passthrough',
  category: 'actuator',
  group: 'pump',
  schema: VfdNodeSchema,
  defaultPorts: [
    { id: 'in', label: 'Inlet', direction: 'inlet' },
    { id: 'out', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: () => ({ name: 'VFD Pump', bus: '', modbus_address: 1 }),

  renderSvg: (_data) => {
    const cx = S / 2, cy = S / 2, r = S / 2 - 5;
    // Sine wave inside circle — represents frequency drive
    const wave = `M ${cx - 12} ${cy} Q ${cx - 6} ${cy - 10} ${cx} ${cy} Q ${cx + 6} ${cy + 10} ${cx + 12} ${cy}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${UI_COLORS.bg}" stroke="${COLOR}" stroke-width="2.5"/>
      <path d="${wave}" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linecap="round"/>
      <text x="${cx}" y="${cy + r - 2}" text-anchor="middle" font-size="8" font-family="ui-monospace, monospace" fill="${COLOR}">VFD</text>
    </svg>`;
  },

  sidebarFields: [
    { key: 'bus', label: 'UART Bus', type: 'text', placeholder: 'uart_modbus' },
    { key: 'modbus_address', label: 'Modbus Address', type: 'number' },
    { key: 'start_register', label: 'Start Register', type: 'number' },
    { key: 'power_register', label: 'Power Register', type: 'number' },
    { key: 'frequency_register', label: 'Frequency Register', type: 'number' },
    { key: 'fault_register', label: 'Fault Register', type: 'number' },
  ],

  // --- Codegen ---

  codegen: {
    hardware: (node) => `\
  # --- VFD: ${node['name']} ---
  # Modbus start/stop switch — same id (pump_relay) as GPIO pump for state machine compat
  - platform: modbus_controller
    modbus_controller_id: ${node['bus']}_modbus
    id: pump_relay
    name: "${node['name']}"
    icon: "mdi:pump"
    register_type: holding
    address: ${node['start_register']}
    bitmask: 1
    write_lambda: |-
      ESP_LOGI("vfd", "Pump %s via Modbus", x ? "START" : "STOP");
      return x;`,

    sensors: (node) => {
      const parts: string[] = [];
      if (node['power_register'] != null) {
        parts.push(`\
  - platform: modbus_controller
    modbus_controller_id: ${node['bus']}_modbus
    id: ${node['id']}_power
    name: "${node['name']} Power"
    register_type: holding
    address: ${node['power_register']}
    unit_of_measurement: "kW"
    icon: "mdi:flash"
    value_type: U_WORD
    accuracy_decimals: 1`);
      }
      if (node['frequency_register'] != null) {
        parts.push(`\
  - platform: modbus_controller
    modbus_controller_id: ${node['bus']}_modbus
    id: ${node['id']}_frequency
    name: "${node['name']} Frequency"
    register_type: holding
    address: ${node['frequency_register']}
    unit_of_measurement: "Hz"
    icon: "mdi:sine-wave"
    value_type: U_WORD
    accuracy_decimals: 1`);
      }
      if (node['fault_register'] != null) {
        parts.push(`\
  - platform: modbus_controller
    modbus_controller_id: ${node['bus']}_modbus
    id: ${node['id']}_fault_code
    name: "${node['name']} Fault Code"
    register_type: holding
    address: ${node['fault_register']}
    icon: "mdi:alert-octagon"
    value_type: U_WORD
    entity_category: diagnostic`);
      }
      return parts.join('\n');
    },

    substitutions: () => [],
  },
};
