/**
 * Route-rule evaluator — walks every route and evaluates entity-declared
 * route rules for each node in the sequence.
 *
 * Route rules are the bridge between pure graph constraints (which only see
 * node kinds) and entity rules (which only see node properties).  They receive
 * both the node data and the route context, making them ideal for conditional
 * topological checks (e.g. "a pressurised water source needs a downstream
 * valve" or "a tank with an intrinsic pressure sensor does not need a
 * downstream level sensor").
 */
import type { TopologyGraph } from './topology-graph';
import type { Route } from './routes';
import type { RuleDiagnostic } from '../validation.types';
import { NODE_REGISTRY } from '../entity-registry';

export function evaluateRouteRules(
  graph: TopologyGraph,
  routes: Route[],
): RuleDiagnostic[] {
  const diagnostics: RuleDiagnostic[] = [];

  for (const route of routes) {
    for (let i = 0; i < route.nodeSequence.length; i++) {
      const nodeId = route.nodeSequence[i];
      const kind = graph.getNodeAttribute(nodeId, 'kind');
      const desc = NODE_REGISTRY.get(kind);
      if (!desc?.routeRules) continue;

      const node = graph.getNodeAttribute(nodeId, 'data');
      for (const rule of desc.routeRules) {
        const diag = rule.evaluate(node, route, graph);
        if (diag) diagnostics.push(diag);
      }
    }
  }

  return diagnostics;
}
