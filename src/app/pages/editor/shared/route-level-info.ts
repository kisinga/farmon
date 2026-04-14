import type { TopologyNode } from '../../../core/models/topology.model';

export interface RouteLevelInfo {
  sourceHasLevel: boolean;
  destHasLevel: boolean;
}

const EMPTY: RouteLevelInfo = { sourceHasLevel: false, destHasLevel: false };

function tankHasLevel(node: TopologyNode | undefined): boolean {
  return !!node && node.kind === 'tank' && !!(node as any).level_pin;
}

/**
 * For a route key like "tank1>tank2", check which endpoints are
 * tanks with a level sensor configured.
 */
export function routeLevelInfo(routeKey: string, nodes: TopologyNode[]): RouteLevelInfo {
  if (!routeKey || !routeKey.includes('>')) return EMPTY;
  const [srcId, dstId] = routeKey.split('>');
  const src = nodes.find(n => n.id === srcId);
  const dst = nodes.find(n => n.id === dstId);
  return {
    sourceHasLevel: tankHasLevel(src),
    destHasLevel: tankHasLevel(dst),
  };
}
