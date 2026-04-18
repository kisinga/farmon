import type { TopologyNode, PipeSegment } from '../../../core/models/topology.model';

export interface RouteLevelInfo {
  sourceHasLevel: boolean;
  destHasLevel: boolean;
}

const EMPTY: RouteLevelInfo = { sourceHasLevel: false, destHasLevel: false };

/**
 * Check if a tank has a level_sensor connected downstream via pipes.
 */
function tankHasLevelSensor(tankId: string, nodes: TopologyNode[], pipes: PipeSegment[]): boolean {
  // Find pipes originating from this tank
  for (const pipe of pipes) {
    const fromNode = pipe.from.split(':')[0];
    if (fromNode !== tankId) continue;
    const toNode = pipe.to.split(':')[0];
    const target = nodes.find(n => n.id === toNode);
    if (target && target.kind === 'level_sensor') return true;
  }
  return false;
}

/**
 * For a route key like "tank1>tank2", check which endpoints are
 * tanks with a level sensor connected downstream.
 */
export function routeLevelInfo(routeKey: string, nodes: TopologyNode[], pipes: PipeSegment[]): RouteLevelInfo {
  if (!routeKey || !routeKey.includes('>')) return EMPTY;
  const [srcId, dstId] = routeKey.split('>');
  const src = nodes.find(n => n.id === srcId);
  const dst = nodes.find(n => n.id === dstId);
  return {
    sourceHasLevel: !!src && src.kind === 'tank' && tankHasLevelSensor(srcId, nodes, pipes),
    destHasLevel: !!dst && dst.kind === 'tank' && tankHasLevelSensor(dstId, nodes, pipes),
  };
}
