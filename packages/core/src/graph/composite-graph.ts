/**
 * Composite graph builder — merges multiple system topologies into a single
 * graphology graph with namespaced IDs.
 *
 * Node IDs use "/" separator: "systemId/nodeId"
 * Pipe IDs use "/" separator: "systemId/pipeId"
 * Inter-system link IDs use "link-" prefix: "link-{linkId}"
 *
 * The resulting TopologyGraph is compatible with all existing graph algorithms
 * (deriveRoutes, pipesFromSource, pipesToDestination, connectedPipes) because
 * those functions treat node/edge IDs as opaque strings.
 */
import Graph from 'graphology';
import { NODE_REGISTRY } from '../entity-registry';
import type { SystemTopology } from '../topology.types';
import type { LinkData } from '../site.types';
import type { TopologyGraph, NodeAttrs, EdgeAttrs } from './topology-graph';

export interface CompositeInput {
  systemId: string;
  topology: SystemTopology;
}

/**
 * Build a single graphology graph from multiple system topologies + links.
 *
 * All existing graph algorithms work on the result because:
 * - Node IDs are opaque strings (now "systemId/nodeId" instead of "nodeId")
 * - Edge pipeId attrs are opaque strings (now "systemId/pipeId" or "link-xxx")
 * - Node attributes (role, routeSource, dispatch flags) are unchanged
 */
export function buildCompositeGraph(
  systems: CompositeInput[],
  links: LinkData[],
): TopologyGraph {
  const g: TopologyGraph = new Graph({ type: 'directed', multi: false });

  // --- Add all systems' nodes and pipes ---
  for (const { systemId, topology } of systems) {
    for (const node of topology.nodes) {
      const desc = NODE_REGISTRY.get(node.kind);
      const nsId = `${systemId}/${node.id}`;

      g.addNode(nsId, {
        kind: node.kind,
        role: desc?.role ?? 'passthrough',
        routeSource: desc?.routeSource ?? false,
        isPump: desc?.isPump ?? false,
        isValve: desc?.isValve ?? false,
        isFlowSensor: desc?.isFlowSensor ?? false,
        isLevelSensor: desc?.isLevelSensor ?? false,
        isPressureSensor: desc?.isPressureSensor ?? false,
        conflictClass: desc?.conflictClass ?? null,
        data: node,
      });
    }

    for (const pipe of topology.pipes) {
      const [fromNode, fromPort] = pipe.from.split(':');
      const [toNode, toPort] = pipe.to.split(':');
      const nsFrom = `${systemId}/${fromNode}`;
      const nsTo = `${systemId}/${toNode}`;

      if (g.hasNode(nsFrom) && g.hasNode(nsTo)) {
        g.addEdge(nsFrom, nsTo, {
          pipeId: `${systemId}/${pipe.id}`,
          fromPort,
          toPort,
        });
      }
    }
  }

  // --- Add inter-system links as edges ---
  for (const link of links) {
    const nsFrom = `${link.fromSystem}/${link.fromNode}`;
    const nsTo = `${link.toSystem}/${link.toNode}`;

    if (g.hasNode(nsFrom) && g.hasNode(nsTo)) {
      g.addEdge(nsFrom, nsTo, {
        pipeId: `link-${link.id}`,
        fromPort: link.fromPort,
        toPort: link.toPort,
      });
    }
  }

  return g;
}
