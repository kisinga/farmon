import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";
import type { SiteTopology, TopologyGraph, Route } from '@far-mon/core';

export const unclaimedRouteNodes: TopologyRule = {
  id: 'unclaimed-route-nodes',
  name: 'Unclaimed route nodes',
  evaluate(_graph: TopologyGraph, routes: Route[], topology?: SiteTopology): RuleDiagnostic[] {
    if (!topology) return [];
    const diagnostics: RuleDiagnostic[] = [];

    for (const controller of topology.controllers) {
      const controllerRoutes = routes.filter(r => {
        if (!r.valid) return false;
        const flowNode = topology.nodes.find(n => n.id === r.flowSensors[0]);
        return flowNode && flowNode.anchorId === controller.id;
      });

      const importedNodeIds = new Set(
        topology.remoteImports
          .filter(c => c.controllerId === controller.id)
          .map(c => c.nodeId),
      );

      const reported = new Set<string>();

      for (const route of controllerRoutes) {
        for (const nodeId of route.nodeSequence) {
          const node = topology.nodes.find(n => n.id === nodeId);
          if (!node) continue;
          if (node.anchorId === controller.id) continue;
          if (importedNodeIds.has(nodeId)) continue;

          const key = `${route.key}:${nodeId}`;
          if (reported.has(key)) continue;
          reported.add(key);

          diagnostics.push({
            severity: 'error',
            message: `Route "${route.key}" references remote node "${node.name || node.id}" on controller "${node.anchorId}" but it is not imported. Add it in the Remotes tab.`,
            target: route.key,
            ruleId: 'unclaimed-route-nodes',
          });
        }
      }
    }

    return diagnostics;
  },
};
