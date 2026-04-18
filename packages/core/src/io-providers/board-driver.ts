/**
 * Board driver — wraps existing resolvePinYaml for native GPIO and
 * PCF8574 expander pins. This is the default (and currently only) driver.
 *
 * Factory: createBoardDriver(board) → IoProviderDriver
 * The BoardDef is captured in the closure — type-safe at creation,
 * context-free at usage.
 */

import type { IoProviderDriver, ResolvedChannel, ChannelUsage, IoChannel } from '../io-provider.types';
import type { BoardDef } from '../board.types';
import { resolvePinYaml } from '../codegen-ids';

export function createBoardDriver(board: BoardDef): IoProviderDriver {
  return {
    enumerate(): IoChannel[] {
      return board.pins.map(p => ({
        fqid: p.gpio,
        label: p.gpio,
        caps: p.caps,
        provider: 'board',
      }));
    },

    resolve(channelId: string, usage: ChannelUsage): ResolvedChannel {
      const pinYaml = resolvePinYaml(channelId, board, {
        inverted: usage.inverted,
        mode: usage.mode,
      });

      switch (usage.purpose) {
        case 'adc':
          return { platform: 'adc', config: `pin:\n    ${pinYaml}\n  attenuation: 12db` };
        case 'pulse_counter':
          return { platform: 'pulse_counter', config: `pin:\n    ${pinYaml}` };
        case 'digital_out':
        case 'digital_in':
          return { platform: 'gpio', config: `pin:\n    ${pinYaml}` };
        default: {
          const _exhaustive: never = usage.purpose;
          throw new Error(`Unknown channel purpose: ${_exhaustive}`);
        }
      }
    },
  };
}
