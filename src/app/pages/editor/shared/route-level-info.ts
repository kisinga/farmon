import type { TopologyNode, PipeSegment } from '../../../core/models/topology.model';
import { buildGraph, activeGraph, resolveTankLevelSources, parseRouteKey } from '@far-mon/core';

export interface RouteLevelInfo {
  sourceHasLevel: boolean;
  destHasLevel: boolean;
}

const EMPTY: RouteLevelInfo = { sourceHasLevel: false, destHasLevel: false };

/**
 * For a route key, check which endpoints are tanks with a resolvable level
 * source (level_sensor OR pressure_sensor — both expose `.level`). Drives
 * which firmware-safety override fields are visible in the UI.
 */
export function routeLevelInfo(routeKey: string, nodes: TopologyNode[], pipes: PipeSegment[]): RouteLevelInfo {
  if (!routeKey || !routeKey.includes('>')) return EMPTY;
  const { source: srcId, destination: dstId } = parseRouteKey(routeKey);
  const graph = activeGraph(buildGraph(nodes, pipes));
  const nodeKindById = new Map(nodes.map(n => [n.id, n.kind]));
  const sources = resolveTankLevelSources(graph, nodeKindById);
  return {
    sourceHasLevel: sources.has(srcId),
    destHasLevel: sources.has(dstId),
  };
}
