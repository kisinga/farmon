import type { Graph, Node, Edge } from '@antv/x6';

export const CONTROLLER_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

const CONTROLLER_WIDTH = 120;
const CONTROLLER_HEIGHT = 36;
const GAP_ABOVE_CLUSTER = 16;

export interface ControllerOverlayOptions {
  controllers?: Array<{ id: string }>;
  friendlyNames?: Map<string, string>;
  positions?: Record<string, { x: number; y: number }>;
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

  // Build complete set of known controller IDs (from explicit list + graph nodes)
  const allControllerIds = new Set<string>();
  for (const c of options.controllers ?? []) allControllerIds.add(c.id);
  for (const id of nodesByController.keys()) allControllerIds.add(id);

  const desiredControllers = new Set<string>();
  const desiredWires = new Set<string>();

  // Sort for stable color assignment
  const sortedIds = [...allControllerIds].sort();
  const colorMap = new Map<string, string>();
  sortedIds.forEach((id, idx) => {
    colorMap.set(id, CONTROLLER_COLORS[idx % CONTROLLER_COLORS.length]);
  });

  // Place controllers that have nodes on the graph
  for (const controllerId of sortedIds) {
    const nodes = nodesByController.get(controllerId);
    if (!nodes || nodes.length === 0) continue;

    const color = colorMap.get(controllerId)!;
    const label = options.friendlyNames?.get(controllerId) ?? controllerId;
    const controllerNodeId = `controller-${controllerId}`;
    desiredControllers.add(controllerNodeId);

    const existing = graph.getCellById(controllerNodeId) as Node | undefined;
    if (existing && controllerLooksSame(existing, color, label)) {
      // Preserve manually dragged position; only recreate if label/color changed.
    } else if (existing) {
      const pos = options.positions?.[controllerId] ?? existing.getPosition();
      existing.remove();
      graph.addNode(buildControllerNode(controllerNodeId, pos, color, label));
    } else {
      const pos = options.positions?.[controllerId] ?? computeControllerPosition(nodes);
      graph.addNode(buildControllerNode(controllerNodeId, pos, color, label));
    }

    // Add/replace wire edges to each owned node
    for (const n of nodes) {
      const wireId = `wire-${controllerId}-${String(n.id).replace(/^node-/, '')}`;
      desiredWires.add(wireId);
      graph.getCellById(wireId)?.remove();
      graph.addEdge({
        id: wireId,
        shape: 'edge',
        source: { cell: controllerNodeId },
        target: { cell: String(n.id) },
        zIndex: -2,
        router: { name: 'orth', args: { padding: 6 } },
        connector: { name: 'rounded' },
        attrs: {
          line: {
            stroke: color + '80',
            strokeWidth: 1,
            strokeDasharray: '3,3',
            targetMarker: null,
          },
        },
      });
    }
  }

  // Place orphan controllers (no nodes yet) in a fallback row
  let orphanX = 20;
  const orphanY = 20;
  for (const controllerId of sortedIds) {
    const nodes = nodesByController.get(controllerId);
    if (nodes && nodes.length > 0) continue;

    const color = colorMap.get(controllerId)!;
    const label = options.friendlyNames?.get(controllerId) ?? controllerId;
    const controllerNodeId = `controller-${controllerId}`;
    desiredControllers.add(controllerNodeId);

    const existing = graph.getCellById(controllerNodeId) as Node | undefined;
    if (existing && controllerLooksSame(existing, color, label)) {
      // Preserve position
    } else if (existing) {
      const pos = options.positions?.[controllerId] ?? existing.getPosition();
      existing.remove();
      graph.addNode(buildControllerNode(controllerNodeId, pos, color, label));
    } else {
      const pos = options.positions?.[controllerId] ?? { x: orphanX, y: orphanY };
      graph.addNode(buildControllerNode(controllerNodeId, pos, color, label));
      if (!options.positions?.[controllerId]) orphanX += CONTROLLER_WIDTH + 20;
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

function controllerLooksSame(node: Node, color: string, label: string): boolean {
  const data = node.getData() as Record<string, unknown> | undefined;
  return data?.['color'] === color && data?.['label'] === label;
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

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function controllerSvg(color: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTROLLER_WIDTH}" height="${CONTROLLER_HEIGHT}">
    <rect x="1" y="1" width="${CONTROLLER_WIDTH - 2}" height="${CONTROLLER_HEIGHT - 2}" rx="6"
      fill="${color}15" stroke="${color}" stroke-width="1.5"/>
    <g transform="translate(10,10)">
      <rect x="0" y="0" width="16" height="16" rx="2" fill="none" stroke="${color}" stroke-width="1.2"/>
      <circle cx="4" cy="5" r="1.2" fill="${color}"/>
      <circle cx="12" cy="5" r="1.2" fill="${color}"/>
      <circle cx="4" cy="11" r="1.2" fill="${color}"/>
      <circle cx="12" cy="11" r="1.2" fill="${color}"/>
    </g>
    <text x="34" y="22" font-size="11" fill="${color}" font-weight="bold"
      font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(label)}</text>
  </svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildControllerNode(
  id: string,
  pos: { x: number; y: number },
  color: string,
  label: string,
): Node.Metadata {
  return {
    shape: 'image',
    id,
    x: pos.x,
    y: pos.y,
    width: CONTROLLER_WIDTH,
    height: CONTROLLER_HEIGHT,
    imageUrl: svgDataUri(controllerSvg(color, label)),
    zIndex: 10,
    data: { controllerId: id.replace(/^controller-/, ''), kind: 'controller', color, label },
  };
}


