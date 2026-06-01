import type { ExpansionBoardDef } from '../board.types';

export const BUILTIN_EXPANSION_BOARDS: Record<string, ExpansionBoardDef> = {
  'waveshare-modbus-ai-8ch': {
    model: 'waveshare_modbus_ai_8ch',
    label: 'Waveshare Modbus RTU AI 8CH',
    transport_type: 'modbus_rtu',
    channels: [
      { id: 'AI1', label: 'AI1', caps: ['adc'], modbus: { register: 0x0000, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI2', label: 'AI2', caps: ['adc'], modbus: { register: 0x0001, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI3', label: 'AI3', caps: ['adc'], modbus: { register: 0x0002, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI4', label: 'AI4', caps: ['adc'], modbus: { register: 0x0003, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI5', label: 'AI5', caps: ['adc'], modbus: { register: 0x0004, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI6', label: 'AI6', caps: ['adc'], modbus: { register: 0x0005, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI7', label: 'AI7', caps: ['adc'], modbus: { register: 0x0006, register_type: 'input', value_type: 'U_WORD' } },
      { id: 'AI8', label: 'AI8', caps: ['adc'], modbus: { register: 0x0007, register_type: 'input', value_type: 'U_WORD' } },
    ],
  },
  'waveshare-modbus-relay-8ch': {
    model: 'waveshare_modbus_relay_8ch',
    label: 'Waveshare Modbus RTU Relay 8CH',
    transport_type: 'modbus_rtu',
    channels: [
      { id: 'DO1', label: 'DO1', caps: ['digital'], modbus: { register: 0x0000, register_type: 'coil' } },
      { id: 'DO2', label: 'DO2', caps: ['digital'], modbus: { register: 0x0001, register_type: 'coil' } },
      { id: 'DO3', label: 'DO3', caps: ['digital'], modbus: { register: 0x0002, register_type: 'coil' } },
      { id: 'DO4', label: 'DO4', caps: ['digital'], modbus: { register: 0x0003, register_type: 'coil' } },
      { id: 'DO5', label: 'DO5', caps: ['digital'], modbus: { register: 0x0004, register_type: 'coil' } },
      { id: 'DO6', label: 'DO6', caps: ['digital'], modbus: { register: 0x0005, register_type: 'coil' } },
      { id: 'DO7', label: 'DO7', caps: ['digital'], modbus: { register: 0x0006, register_type: 'coil' } },
      { id: 'DO8', label: 'DO8', caps: ['digital'], modbus: { register: 0x0007, register_type: 'coil' } },
    ],
  },
};

export function listBuiltinExpansionBoards(): string[] {
  return Object.keys(BUILTIN_EXPANSION_BOARDS);
}
