import type { TopologyRule, RuleDiagnostic } from "../rule.types";
import type { SiteTopology, TopologyGraph, Route } from '@core';

/**
 * Managed mode — no cross-controller dependencies.
 *
 * In managed mode controllers can't coordinate (each is an island wired to its
 * own sensors/actuators), so:
 *   - a route may not span more than one controller, and
 *   - cross-controller imports aren't possible at all.
 *
 * Only added to the rule set when the deployment mode is `managed`
 * (see rules/index.ts). In local mode these dependencies are legal and this
 * rule never runs.
 */
export const managedCrossController: TopologyRule = {
  id: 'managed-cross-controller',
  name: 'Managed mode — no cross-controller dependencies',
  evaluate(_graph: TopologyGraph, routes: Route[], topology?: SiteTopology): RuleDiagnostic[] {
    if (!topology) return [];
    const diagnostics: RuleDiagnostic[] = [];
    const anchorOf = new Map(topology.nodes.map(n => [n.id, n.anchorId]));

    for (const route of routes) {
      const anchors = new Set<string>();
      for (const nodeId of route.nodeSequence) {
        const a = anchorOf.get(nodeId);
        if (a) anchors.add(a);
      }
      if (anchors.size > 1) {
        diagnostics.push({
          severity: 'error',
          message: `Route "${route.key}" spans controllers (${[...anchors].sort().join(', ')}). In managed mode controllers can't coordinate — keep each route on one controller, or switch the site to local mode.`,
          target: route.key,
          ruleId: 'managed-cross-controller',
        });
      }
    }

    if (topology.remoteImports.length > 0) {
      diagnostics.push({
        severity: 'error',
        message: `Managed mode can't use cross-controller imports (${topology.remoteImports.length} present). Imports rely on inter-controller coordination, which only local mode provides. Remove them or switch to local mode.`,
        target: 'site',
        ruleId: 'managed-cross-controller',
      });
    }

    return diagnostics;
  },
};
