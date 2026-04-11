import type { Graph } from '@antv/x6';
import { BOUNDARY_SHAPE } from '../../pages/editor/topology-x6-tab/x6-shapes';

const BOUNDARY_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];
const BOUNDARY_PADDING = 30;

/**
 * Add semi-transparent boundary rectangles around each system's nodes in a composite graph.
 * Call after `X6Canvas.reset()` has rendered the composite topology.
 *
 * @param graph - The X6 Graph instance
 * @param systemNodes - Map of configName → node IDs belonging to that system
 */
export function renderBoundaries(
  graph: Graph,
  systemNodes: Map<string, string[]>,
  friendlyNames?: Map<string, string>,
): void {
  let colorIdx = 0;
  for (const [config, nodeIds] of systemNodes) {
    const nodes = nodeIds
      .map(id => graph.getCellById(`node-${id}`))
      .filter(n => n?.isNode());
    if (nodes.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const pos = (n as any).getPosition();
      const size = (n as any).getSize();
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }

    const color = BOUNDARY_COLORS[colorIdx % BOUNDARY_COLORS.length];
    graph.addNode({
      shape: BOUNDARY_SHAPE,
      id: `boundary-${config}`,
      x: minX - BOUNDARY_PADDING,
      y: minY - BOUNDARY_PADDING - 20,
      width: maxX - minX + BOUNDARY_PADDING * 2,
      height: maxY - minY + BOUNDARY_PADDING * 2 + 20,
      zIndex: -1,
      attrs: {
        body: {
          fill: `${color}08`,
          stroke: color,
          strokeWidth: 1.5,
          strokeDasharray: '6,3',
          rx: 8,
          ry: 8,
          cursor: 'pointer',
        },
        label: {
          text: friendlyNames?.get(config) ?? config,
          fill: color,
          fontSize: 11,
          fontWeight: 'bold',
          refX: BOUNDARY_PADDING,
          refY: 12,
          textAnchor: 'start',
          cursor: 'pointer',
        },
      },
    });
    colorIdx++;
  }
}
