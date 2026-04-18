/**
 * Channel resolution — the bridge between entities and transport drivers.
 *
 * Two exports:
 *   buildResolveChannel()     — factory, called once by the collector
 *   resolveComponentHeader()  — composition utility, called by every entity
 */

import type { ChannelUsage, ResolvedChannel } from '../io-provider.types';
import type { BoardDef } from '../board.types';
import type { CodegenContext } from '../entity-registry';
import { createBoardDriver } from './board-driver';

/**
 * Factory — builds the resolveChannel function for a given board
 * (and future io_providers). Called once by collect.ts.
 */
export function buildResolveChannel(
  board: BoardDef,
  // Future: providers?: Array<{ id: string; driver: IoProviderDriver }>
): (channelId: string, usage: ChannelUsage) => ResolvedChannel {
  const boardDrv = createBoardDriver(board);
  // Future: build a Map<string, IoProviderDriver> from providers param

  return (channelId: string, usage: ChannelUsage): ResolvedChannel => {
    // Future: if channelId contains ':', split on first ':' and look up provider driver
    // const colonIdx = channelId.indexOf(':');
    // if (colonIdx > 0) { ... look up driver ... }

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
