/**
 * Conflict detection types and logic.
 *
 * Generalizes route-concurrency.ts beyond flow-sensor-only detection
 * to cover shared valves, pumps, and any passthrough entity.
 */
import type { TopologyGraph } from './topology-graph';
import type { Route } from './routes';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SharedResource {
  nodeId: string;
  kind: string;
  type: 'sensor' | 'actuator';
}

export interface RouteConflict {
  routeA: string;
  routeB: string;
  shared: SharedResource[];
  /** True if routes cannot run concurrently (sensor ambiguity). */
  blocking: boolean;
  resolution: 'queue' | 'refcount';
}

export interface ConflictManifest {
  conflicts: RouteConflict[];
}

// ── Detection ───────────────────────────────────────────────────────────────

export function detectConflicts(routes: Route[], graph: TopologyGraph): ConflictManifest {
  const conflicts: RouteConflict[] = [];

  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i];
      const b = routes[j];

      // Find shared passthrough nodes (exclude source and dest terminals)
      const innerA = new Set(a.nodeSequence.slice(1, -1));
      const innerB = new Set(b.nodeSequence.slice(1, -1));
      const sharedIds = [...innerA].filter(id => innerB.has(id));

      if (sharedIds.length === 0) continue;

      const shared: SharedResource[] = sharedIds.map(nodeId => ({
        nodeId,
        kind: graph.getNodeAttribute(nodeId, 'kind'),
        type: graph.getNodeAttribute(nodeId, 'conflictClass') ?? 'actuator',
      }));

      // Blocking = shared sensor with different destinations (ambiguous reading)
      const hasSensorConflict = shared.some(r =>
        r.type === 'sensor' && a.destination !== b.destination
      );

      conflicts.push({
        routeA: a.key,
        routeB: b.key,
        shared,
        blocking: hasSensorConflict,
        resolution: hasSensorConflict ? 'queue' : 'refcount',
      });
    }
  }

  return { conflicts };
}
