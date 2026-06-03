/**
 * Generic expansion board driver.
 *
 * Works for any ExpansionBoardDef: enumerates channels by cap and resolves
 * channel + usage to ESPHome YAML via the board's transport metadata.
 */

import type { IoProviderDriver, IoChannel, ChannelUsage, ResolvedChannel } from '../io-provider.types';
import type { ExpansionBoardDef, ExpansionBoardChannelDef, TransportType } from '../board.types';
import type { IoProviderInstanceConfig } from '../topology.types';

export function createExpansionBoardDriver(
  boardDef: ExpansionBoardDef,
  transport: IoProviderInstanceConfig,
): IoProviderDriver {
  switch (boardDef.transport_type) {
    case 'modbus_rtu':
      return createModbusExpansionBoardDriver(boardDef, transport);
    default:
      throw new Error(`Unsupported expansion board transport: "${boardDef.transport_type}"`);
  }
}

function createModbusExpansionBoardDriver(
  boardDef: ExpansionBoardDef,
  transport: IoProviderInstanceConfig,
): IoProviderDriver {
  const modbusId = `${transport.bus}_modbus`;

  return {
    enumerate(): IoChannel[] {
      return boardDef.channels.map(ch => ({
        fqid: ch.id,
        label: ch.label ?? ch.id,
        caps: ch.caps,
        provider: '',
      }));
    },

    resolve(channelId: string, usage: ChannelUsage): ResolvedChannel {
      const ch = boardDef.channels.find(c => c.id === channelId);
      if (!ch) throw new Error(`Unknown channel "${channelId}" on expansion board "${boardDef.model}"`);

      const modbus = ch.modbus;
      if (!modbus) {
        throw new Error(`Channel "${channelId}" on "${boardDef.model}" missing modbus metadata`);
      }

      const lines = [
        `modbus_controller_id: ${modbusId}`,
        `register_type: ${modbus.register_type}`,
        `address: ${modbus.register}`,
      ];
      if (modbus.value_type) {
        lines.push(`value_type: ${modbus.value_type}`);
      }

      return {
        platform: 'modbus_controller',
        config: lines.join('\n  '),
        controllerId: modbusId,
      };
    },

    infrastructureYaml(): Array<{ section: string; yaml: string }> {
      return [{
        section: 'modbus_controller',
        yaml: `  - id: ${modbusId}_dev_${transport.address}\n    modbus_id: ${modbusId}\n    address: ${transport.address}`,
      }];
    },
  };
}
