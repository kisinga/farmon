/**
 * Constraint evaluator — walks every route, collects constraints from
 * all entities in the node sequence, and checks them.
 *
 * Replaces the separate topology rule files:
 *   - pump-inlet-valve.ts
 *   - pump-outlet-ordering.ts
 *   - endpoint-flow-warning.ts
 */
import type { TopologyGraph } from './topology-graph';
import type { Route } from './routes';
import type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './constraints';
// TODO: This import couples constraint evaluation to the registry. conflicts.ts
// is self-contained (reads conflictClass from graph attrs). Refactor if
// constraints move to NodeAttrs so this can read them from the graph too.
import { NODE_REGISTRY } from '../entity-registry';
import type { RuleDiagnostic } from '../validation.types';

// ── Constraint checking ─────────────────────────────────────────────────────

function checkPresence(
  c: PresenceConstraint,
  nodeIdx: number,
  route: Route,
  graph: TopologyGraph,
): boolean {
  const seq = route.nodeSequence;
  let searchRange: string[];

  if (c.position === 'upstream') {
    searchRange = seq.slice(0, nodeIdx);
    // Terminal at route start: no upstream in route, check graph in-neighbors
    if (searchRange.length === 0 && nodeIdx === 0) {
      searchRange = graph.inNeighbors(seq[0]);
    }
  } else if (c.position === 'downstream') {
    searchRange = seq.slice(nodeIdx + 1);
    // Terminal at route end: no downstream in route, check graph out-neighbors
    if (searchRange.length === 0 && nodeIdx === seq.length - 1) {
      searchRange = graph.outNeighbors(seq[nodeIdx]);
    }
  } else {
    // 'anywhere' — everything except the declaring node itself
    searchRange = [...seq.slice(0, nodeIdx), ...seq.slice(nodeIdx + 1)];
  }

  return searchRange.some(id => (c.requiredKind as string[]).includes(graph.getNodeAttribute(id, 'kind')));
}

function checkOrdering(
  c: OrderingConstraint,
  nodeIdx: number,
  route: Route,
  graph: TopologyGraph,
): boolean {
  const seq = route.nodeSequence;
  const segment = c.segment === 'upstream'
    ? seq.slice(0, nodeIdx)
    : seq.slice(nodeIdx + 1);

  let firstIdx = -1;
  let secondIdx = -1;

  for (let i = 0; i < segment.length; i++) {
    const kind = graph.getNodeAttribute(segment[i], 'kind');
    if (kind === c.firstKind && firstIdx === -1) firstIdx = i;
    if (kind === c.secondKind && secondIdx === -1) secondIdx = i;
  }

  // If both exist, first must come before second
  if (firstIdx >= 0 && secondIdx >= 0) {
    return firstIdx < secondIdx;
  }

  // If only one or neither exists, ordering is not violated
  return true;
}

// ── Main evaluator ──────────────────────────────────────────────────────────

export function evaluateConstraints(
  graph: TopologyGraph,
  routes: Route[],
): RuleDiagnostic[] {
  const diagnostics: RuleDiagnostic[] = [];

  for (const route of routes) {
    for (let i = 0; i < route.nodeSequence.length; i++) {
      const nodeId = route.nodeSequence[i];
      const kind = graph.getNodeAttribute(nodeId, 'kind');
      const desc = NODE_REGISTRY.get(kind);
      if (!desc?.constraints) continue;

      for (const constraint of desc.constraints) {
        let satisfied: boolean;

        if (constraint.type === 'presence') {
          satisfied = checkPresence(constraint, i, route, graph);
        } else {
          satisfied = checkOrdering(constraint, i, route, graph);
        }

        if (!satisfied) {
          diagnostics.push({
            severity: constraint.baseSeverity,
            message: `Route "${route.key}": ${constraint.description}`,
            target: route.key,
            ruleId: constraint.id,
          });
        }
      }
    }
  }

  return diagnostics;
}
