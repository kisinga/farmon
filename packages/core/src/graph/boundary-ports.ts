/**
 * Boundary port detection — identifies unconnected ports on terminal nodes.
 *
 * A boundary port is an exposed inlet/outlet that can be linked to another
 * system at the site level. Interconnect entities are the primary boundary nodes,
 * but any terminal with an unconnected port qualifies.
 */
import type { SystemTopology } from '../topology.types';
import { NODE_REGISTRY } from '../entity-registry';

export interface BoundaryPort {
  nodeId: string;
  portId: string;
  direction: 'inlet' | 'outlet';
  nodeKind: string;
  nodeName: string;
}

/**
 * Find all unconnected ports on terminal nodes in a topology.
 * These are the ports eligible for inter-system linking.
 */
export function boundaryPorts(topology: SystemTopology): BoundaryPort[] {
  // Collect all connected port refs: "nodeId:portId"
  const connected = new Set<string>();
  for (const pipe of topology.pipes) {
    connected.add(pipe.from);
    connected.add(pipe.to);
  }

  const result: BoundaryPort[] = [];

  for (const node of topology.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc || desc.role !== 'terminal') continue;

    for (const port of node.ports) {
      const ref = `${node.id}:${port.id}`;
      if (!connected.has(ref)) {
        result.push({
          nodeId: node.id,
          portId: port.id,
          direction: port.direction,
          nodeKind: node.kind,
          nodeName: (node as any).name ?? node.id,
        });
      }
    }
  }

  return result;
}
