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
      // Direction must follow purpose, not be inferred from `inverted`.
      // active-high relay drives have inverted=false but still need OUTPUT mode.
      const mode = usage.mode
        ?? (usage.purpose === 'digital_out' ? 'OUTPUT' : undefined);
      const pinYaml = resolvePinYaml(channelId, board, {
        inverted: usage.inverted,
        mode,
      });

      switch (usage.purpose) {
        case 'adc': {
          const pin = board.pins.find(p => p.gpio === channelId || p.connector === channelId);
          return {
            platform: 'adc',
            config: `pin:\n    ${pinYaml}\n  attenuation: 12db`,
            adcFullScaleV: pin?.adc_full_scale_v ?? 3.3,
          };
        }
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
