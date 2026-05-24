import type { Graph, Node, Edge } from '@antv/x6';
import type { SiteTopology, TopologyNode } from '../../core/models/topology.model';

export const CONTROLLER_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

const CONTROLLER_WIDTH = 120;
const CONTROLLER_HEIGHT = 36;
const GAP_ABOVE_CLUSTER = 16;

interface ControllerOverlayOptions {
  friendlyNames?: Map<string, string>;
}

/**
 * Add controller nodes and wire edges to a composite (site-level) graph.
 *
 * Each controller gets a small labeled rect positioned above its node cluster,
 * with thin dashed edges ("wires") running to every owned node.
 *
 * The draw is synchronous: node positions are already committed by the time
 * overlays run, and straight edges need no router computation.
 */
export function renderControllerOverlays(
  graph: Graph,
  topology: SiteTopology,
  options: ControllerOverlayOptions = {},
): void {
  const nodesByController = new Map<string, Node[]>();
  for (const node of graph.getNodes()) {
    const data = node.getData() as Record<string, unknown> | undefined;
    const anchorId = data?.['anchorId'] as string | undefined;
    if (!anchorId) continue;
    const list = nodesByController.get(anchorId) ?? [];
    list.push(node);
    nodesByController.set(anchorId, list);
  }

  const desiredControllers = new Set<string>();
  const desiredWires = new Set<string>();

  let colorIdx = 0;
  for (const [controllerId, nodes] of nodesByController) {
    if (nodes.length === 0) continue;

    const color = CONTROLLER_COLORS[colorIdx % CONTROLLER_COLORS.length];
    colorIdx++;

    const pos = computeControllerPosition(nodes);
    const controllerNodeId = `controller-${controllerId}`;
    desiredControllers.add(controllerNodeId);

    // Replace or add controller node
    graph.getCellById(controllerNodeId)?.remove();
    graph.addNode(buildControllerNode(controllerNodeId, pos, color, options.friendlyNames?.get(controllerId) ?? controllerId));

    // Add/replace wire edges to each owned node
    for (const n of nodes) {
      const wireId = `wire-${controllerId}-${String(n.id).replace(/^node-/, '')}`;
      desiredWires.add(wireId);
      graph.getCellById(wireId)?.remove();
      graph.addEdge(buildWireEdge(wireId, controllerNodeId, String(n.id)));
    }
  }

  // Remove stale controller nodes
  for (const cell of graph.getCells()) {
    const id = String(cell.id);
    if (id.startsWith('controller-') && !desiredControllers.has(id)) {
      cell.remove();
    }
    if (id.startsWith('wire-') && !desiredWires.has(id)) {
      cell.remove();
    }
  }
}

function computeControllerPosition(nodes: ReadonlyArray<Node>): { x: number; y: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const { x, y } = n.getPosition();
    const { width } = n.getSize();
    if (x < minX) minX = x;
    if (x + width > maxX) maxX = x + width;
    if (y < minY) minY = y;
  }
  const cx = (minX + maxX) / 2;
  return {
    x: cx - CONTROLLER_WIDTH / 2,
    y: minY - CONTROLLER_HEIGHT - GAP_ABOVE_CLUSTER,
  };
}

function buildControllerNode(
  id: string,
  pos: { x: number; y: number },
  color: string,
  label: string,
): Node.Metadata {
  return {
    shape: 'rect',
    id,
    x: pos.x,
    y: pos.y,
    width: CONTROLLER_WIDTH,
    height: CONTROLLER_HEIGHT,
    zIndex: 0,
    attrs: {
      body: {
        fill: `${color}15`,
        stroke: color,
        strokeWidth: 1.5,
        rx: 6,
        ry: 6,
        cursor: 'pointer',
      },
      label: {
        text: label,
        fill: color,
        fontSize: 11,
        fontWeight: 'bold',
        textVerticalAnchor: 'middle',
        textAnchor: 'middle',
        cursor: 'pointer',
      },
    },
    data: { controllerId: id.replace(/^controller-/, ''), kind: 'controller' },
  };
}

function buildWireEdge(id: string, sourceCell: string, targetCell: string): Edge.Metadata {
  return {
    id,
    shape: 'edge',
    source: { cell: sourceCell },
    target: { cell: targetCell },
    zIndex: -2,
    attrs: {
      line: {
        stroke: '#94a3b8',
        strokeWidth: 1,
        strokeDasharray: '3,3',
        targetMarker: null,
      },
    },
    connector: { name: 'rounded' },
  };
}
