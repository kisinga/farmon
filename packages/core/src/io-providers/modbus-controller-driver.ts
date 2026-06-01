/**
 * Modbus controller driver — transport endpoint for Modbus RTU devices.
 *
 * Unlike channel-based providers (MUX, DIO), a Modbus controller is a
 * transport endpoint. It doesn't enumerate channels — entities reference
 * it directly and provide register-level details (address, type, bitmask).
 *
 * Factory: createModbusControllerDriver(config) → IoProviderDriver
 */

import type { IoProviderDriver, ResolvedChannel, ChannelUsage, IoChannel } from '../io-provider.types';
import type { PinCap } from '../board.types';

interface ModbusControllerConfig {
  bus: string;       // UART bus ID (e.g., 'uart_modbus')
  address: number;   // Modbus device address (1-247)
}

export function createModbusControllerDriver(config: ModbusControllerConfig): IoProviderDriver {
  const modbusId = `${config.bus}_modbus`;

  return {
    enumerate(): IoChannel[] {
      // Transport endpoint — enumerates itself as a single channel.
      // Provider ID becomes the channel ID via direct provider dispatch.
      return [{
        fqid: '',
        label: `Modbus @${config.address}`,
        caps: [] as PinCap[],
        provider: '',
      }];
    },

    resolve(_channelId: string, _usage: ChannelUsage): ResolvedChannel {
      // All Modbus components get the same platform + controller reference.
      // Entity appends register-specific config (address, register_type, etc.)
      return {
        platform: 'modbus_controller',
        config: `modbus_controller_id: ${modbusId}`,
        controllerId: modbusId,
      };
    },
  };
}
