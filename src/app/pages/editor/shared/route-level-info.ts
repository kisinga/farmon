import type { TopologyNode, PipeSegment } from '../../../core/models/topology.model';
import { buildGraph, activeGraph, parseRouteKey } from '@far-mon/core';

export interface RouteLevelInfo {
  sourceHasLevel: boolean;
  destHasLevel: boolean;
}

const EMPTY: RouteLevelInfo = { sourceHasLevel: false, destHasLevel: false };

/**
 * For a route key, check which endpoints are tanks with intrinsic level
 * monitoring (`level_monitored === true`). Drives which firmware-safety
 * override fields are visible in the UI.
 */
export function routeLevelInfo(routeKey: string, nodes: TopologyNode[], pipes: PipeSegment[]): RouteLevelInfo {
  if (!routeKey || !routeKey.includes('>')) return EMPTY;
  const { source: srcId, destination: dstId } = parseRouteKey(routeKey);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const srcNode = nodeById.get(srcId);
  const dstNode = nodeById.get(dstId);
  return {
    sourceHasLevel: srcNode?.kind === 'tank' && (srcNode as Record<string, unknown>)['level_monitored'] === true,
    destHasLevel: dstNode?.kind === 'tank' && (dstNode as Record<string, unknown>)['level_monitored'] === true,
  };
}
