import type { SiteTopology } from './topology.types';
import { buildGraph } from './graph/topology-graph';
import { activeGraph } from './graph/active-graph';
import { deriveRoutes } from './graph/routes';

/** Whether a site's design uses cross-controller coordination. */
export interface CrossControllerReport {
  /** True when the design uses inter-controller coordination. */
  hasCrossTalk: boolean;
  /** Route keys whose nodes span more than one controller. */
  spanningRoutes: string[];
  /** Count of explicit cross-controller imports. */
  importCount: number;
}

/**
 * Detect whether a site's design uses cross-controller coordination ("cross-talk"):
 * a route whose nodes span more than one controller, or an explicit cross-controller
 * import. Coordination runs over the LAN UDP lane (coordination.ts) in both
 * deployment modes. Pure and site-level (no per-controller manifest needed) — the
 * deployment UI surfaces it as live design info.
 */
export function detectCrossControllerTalk(topology: SiteTopology): CrossControllerReport {
  const routes = deriveRoutes(activeGraph(buildGraph(topology.nodes, topology.pipes)));
  const anchorOf = new Map(topology.nodes.map(n => [n.id, n.anchorId]));

  const spanningRoutes: string[] = [];
  for (const route of routes) {
    const anchors = new Set<string>();
    for (const nodeId of route.nodeSequence) {
      const a = anchorOf.get(nodeId);
      if (a) anchors.add(a);
    }
    if (anchors.size > 1) spanningRoutes.push(route.key);
  }

  const importCount = topology.remoteImports?.length ?? 0;
  return {
    hasCrossTalk: spanningRoutes.length > 0 || importCount > 0,
    spanningRoutes,
    importCount,
  };
}
