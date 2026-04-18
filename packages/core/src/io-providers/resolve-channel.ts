/**
 * Channel resolution — the bridge between entities and transport drivers.
 *
 * Two exports:
 *   buildResolveChannel()     — factory, called once by the collector
 *   resolveComponentHeader()  — composition utility, called by every entity
 */

import type { ChannelUsage, ResolvedChannel, IoProviderDriver } from '../io-provider.types';
import type { BoardDef } from '../board.types';
import type { CodegenContext } from '../entity-registry';
import { createBoardDriver } from './board-driver';

/**
 * Factory — builds the resolveChannel function for a given board
 * and optional I/O providers. Called once by collect.ts.
 */
export function buildResolveChannel(
  board: BoardDef,
  providers?: Array<{ id: string; driver: IoProviderDriver }>,
): (channelId: string, usage: ChannelUsage) => ResolvedChannel {
  const boardDrv = createBoardDriver(board);
  const providerMap = new Map(providers?.map(p => [p.id, p.driver]) ?? []);

  return (channelId: string, usage: ChannelUsage): ResolvedChannel => {
    // Channel on a provider: "mux1:CH3" → split, dispatch to provider
    const colonIdx = channelId.indexOf(':');
    if (colonIdx > 0) {
      const providerId = channelId.slice(0, colonIdx);
      const channel = channelId.slice(colonIdx + 1);
      const driver = providerMap.get(providerId);
      if (!driver) throw new Error(`Unknown I/O provider "${providerId}" in channel "${channelId}"`);
      return driver.resolve(channel, usage);
    }
    // Direct provider reference (transport endpoint): "vfd1_ctrl"
    const directDriver = providerMap.get(channelId);
    if (directDriver) return directDriver.resolve('', usage);
    // Board pin: "GPIO36", "OUT1"
    return boardDrv.resolve(channelId, usage);
  };
}

/**
 * Composition utility — the ONE function every entity calls.
 *
 * Returns the ESPHome component header (platform + transport config).
 * Entity appends its own id, name, filters, lambdas after this.
 *
 * No fallback. Requires a fully constructed context.
 */
export function resolveComponentHeader(
  ctx: CodegenContext,
  channelId: string,
  usage: ChannelUsage,
): string {
  if (!channelId) return '';
  const ch = ctx.resolveChannel(channelId, usage);
  return `- platform: ${ch.platform}\n  ${ch.config}`;
}
