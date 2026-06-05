import type { SiteTopology } from './topology.types';
import { buildGraph } from './graph/topology-graph';
import { activeGraph } from './graph/active-graph';
import { deriveRoutes } from './graph/routes';

/** Why a site needs controllers to coordinate (and thus needs local mode). */
export interface CrossControllerReport {
  /** True when the design needs inter-controller coordination. */
  hasCrossTalk: boolean;
  /** Route keys whose nodes span more than one controller. */
  spanningRoutes: string[];
  /** Count of explicit cross-controller imports. */
  importCount: number;
}

/**
 * Detect whether a site's design needs controllers to talk to each other
 * ("cross-talk"): a route whose nodes span more than one controller, or an
 * explicit cross-controller import.
 *
 * Such designs only work in local mode (an on-site broker lets controllers
 * coordinate); online/managed mode treats each controller as an island. This is
 * the same condition the `managed-cross-controller` validation rule enforces,
 * exposed as a pure, site-level helper so the deployment UI can show a live
 * verdict next to the Online/Local choice without building a per-controller
 * manifest.
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
