import { z } from 'zod';
import type { NodeDescriptor } from '../entity-registry';
import { ComponentId, PortSchema, PositionSchema } from '../schemas';
import { UI_COLORS } from '../colors';
import { pumpSwitchId } from '../codegen-ids';
import { resolveComponentHeader } from '../io-providers/resolve-channel';

const COLOR = '#7c3aed'; // violet
const S = 60;

// --- Schema ---

export const VfdNodeSchema = z.object({
  kind: z.literal('vfd'),
  id: ComponentId,
  name: z.string().default('VFD Pump'),
  controller: ComponentId,
  start_register: z.number().default(0x0001),
  speed_register: z.number().optional(),
  max_frequency: z.number().default(50),
  power_register: z.number().optional(),
  frequency_register: z.number().optional(),
  fault_register: z.number().optional(),
  fault_reset_register: z.number().optional(),
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
  defaultData: () => ({ name: 'VFD Pump', controller: '', max_frequency: 50 }),

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
    { key: 'controller', label: 'Controller', type: 'provider', providerType: 'modbus_controller' },
    { key: 'start_register', label: 'Start Register', type: 'number' },
    { key: 'speed_register', label: 'Speed Register', type: 'number' },
    { key: 'max_frequency', label: 'Max Frequency (Hz)', type: 'number' },
    { key: 'power_register', label: 'Power Register', type: 'number' },
    { key: 'frequency_register', label: 'Frequency Register', type: 'number' },
    { key: 'fault_register', label: 'Fault Register', type: 'number' },
    { key: 'fault_reset_register', label: 'Fault Reset Register', type: 'number' },
  ],

  // --- Codegen ---

  codegen: {
    hardware: (node: VfdNode, _idx, ctx) => {
      const id = pumpSwitchId();
      const header = resolveComponentHeader(ctx, node.controller, { purpose: 'digital_out' });
      return `\
# --- VFD: ${node.name} ---
# Modbus start/stop switch — same id (${id}) as GPIO pump for state machine compat
${header}
  id: ${id}
  name: "${node.name}"
  icon: "mdi:pump"
  register_type: holding
  address: ${node.start_register}
  bitmask: 1
  write_lambda: |-
    ESP_LOGI("vfd", "Pump %s via Modbus", x ? "START" : "STOP");
    return x;`;
    },

    sensors: (node: VfdNode, _idx, ctx) => {
      const parts: string[] = [];
      if (node.power_register != null) {
        const header = resolveComponentHeader(ctx, node.controller, { purpose: 'adc' });
        parts.push(`\
${header}
  id: ${node.id}_power
  name: "${node.name} Power"
  register_type: holding
  address: ${node.power_register}
  unit_of_measurement: "kW"
  icon: "mdi:flash"
  value_type: U_WORD
  accuracy_decimals: 1`);
      }
      if (node.frequency_register != null) {
        const header = resolveComponentHeader(ctx, node.controller, { purpose: 'adc' });
        parts.push(`\
${header}
  id: ${node.id}_frequency
  name: "${node.name} Frequency"
  register_type: holding
  address: ${node.frequency_register}
  unit_of_measurement: "Hz"
  icon: "mdi:sine-wave"
  value_type: U_WORD
  accuracy_decimals: 1`);
      }
      if (node.fault_register != null) {
        const header = resolveComponentHeader(ctx, node.controller, { purpose: 'adc' });
        parts.push(`\
${header}
  id: ${node.id}_fault_code
  name: "${node.name} Fault Code"
  register_type: holding
  address: ${node.fault_register}
  icon: "mdi:alert-octagon"
  value_type: U_WORD
  entity_category: diagnostic`);
      }
      return parts.join('\n');
    },

    extraComponents: (node: VfdNode, _idx, ctx) => {
      const sections: Record<string, string> = {};
      if (node.speed_register != null) {
        const header = resolveComponentHeader(ctx, node.controller, { purpose: 'digital_out' });
        sections['number'] = `\
${header}
  id: ${node.id}_speed_setpoint
  name: "${node.name} Speed Setpoint"
  register_type: holding
  address: ${node.speed_register}
  min_value: 0
  max_value: ${node.max_frequency ?? 50}
  unit_of_measurement: "Hz"
  icon: "mdi:speedometer"
  value_type: U_WORD`;
      }
      if (node.fault_reset_register != null) {
        // Template button — uses controllerId for raw Modbus write in C++ lambda
        const ch = ctx.resolveChannel(node.controller, { purpose: 'digital_out' });
        if (!ch.controllerId) throw new Error(`Provider "${node.controller}" did not return controllerId for fault reset lambda`);
        const modbusRef = ch.controllerId;
        sections['button'] = `\
- platform: template
  id: ${node.id}_fault_reset
  name: "${node.name} Fault Reset"
  icon: "mdi:restart"
  on_press:
    - lambda: |-
        auto call = id(${modbusRef}).make_set_holding_call();
        call.set_address(${node.fault_reset_register});
        call.set_value(1);
        call.perform();
        ESP_LOGI("vfd", "Fault reset sent to ${node.name}");`;
      }
      return sections;
    },

    substitutions: () => [],
  },
};
