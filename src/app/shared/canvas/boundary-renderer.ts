import type { Graph, Node, EdgeView } from '@antv/x6';
import { BOUNDARY_SHAPE } from '../../pages/editor/topology-x6-tab/x6-shapes';

export const BOUNDARY_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];
export const BOUNDARY_PADDING = 30;
export const LABEL_HEIGHT = 24;

type BBox = { x: number; y: number; width: number; height: number };

/**
 * Add semi-transparent boundary rectangles around each system's nodes.
 * Call after `X6Canvas.reset()` has added the composite cells.
 *
 * The draw is deferred until X6's router has committed routed path geometry,
 * so each system's bbox can include Manhattan detours — otherwise pipes that
 * bend around neighbours clip through the dashed stroke.
 *
 * Two triggers, whichever fires first (guarded by `ran` for idempotency):
 *   - `render:done`: fires after X6's async render cycle completes. Primary
 *     path for the live site view (`async: true`).
 *   - 2 × requestAnimationFrame: primary path for the synchronous export
 *     renderer, where `render:done` may already have fired before we attached.
 *     Also a safety net if the graph was idle when we were called.
 */
export function renderBoundaries(
  graph: Graph,
  systemNodes: Map<string, string[]>,
  friendlyNames?: Map<string, string>,
): void {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    graph.off('render:done', run);
    drawBoundaries(graph, systemNodes, friendlyNames);
  };
  graph.once('render:done', run);
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function drawBoundaries(
  graph: Graph,
  systemNodes: Map<string, string[]>,
  friendlyNames?: Map<string, string>,
): void {
  let colorIdx = 0;
  for (const [config, nodeIds] of systemNodes) {
    const nodes = nodeIds
      .map(id => graph.getCellById(`node-${id}`))
      .filter((n): n is Node => !!n?.isNode());
    if (nodes.length === 0) continue;

    const bbox = computeSystemBBox(graph, nodes);
    const color = BOUNDARY_COLORS[colorIdx % BOUNDARY_COLORS.length];

    // Replace an existing boundary for this config so re-renders don't collide
    // on duplicate IDs (the composite graph may be reset between calls, but a
    // stale deferred draw could also land on a fresh graph).
    const boundaryId = `boundary-${config}`;
    graph.getCellById(boundaryId)?.remove();
    graph.addNode(buildBoundarySpec(boundaryId, bbox, color, friendlyNames?.get(config) ?? config));
    colorIdx++;
  }
}

/**
 * Union of each node's rect and each intra-system edge's routed path bbox.
 * Uses `EdgeView.getConnection()` — the routed `Path` built by the router,
 * not the straight source→target bbox that `view.getBBox()` returns.
 * Inter-system edges are skipped so one system's boundary never stretches
 * to swallow another's.
 */
function computeSystemBBox(graph: Graph, nodes: ReadonlyArray<Node>): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (x: number, y: number, w: number, h: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  };

  for (const n of nodes) {
    const { x, y } = n.getPosition();
    const { width, height } = n.getSize();
    extend(x, y, width, height);
  }

  const cellIdSet = new Set(nodes.map(n => n.id));
  for (const edge of graph.getEdges()) {
    const s = edge.getSourceCellId();
    const t = edge.getTargetCellId();
    if (!s || !t || !cellIdSet.has(s) || !cellIdSet.has(t)) continue;
    const view = graph.findViewByCell(edge) as EdgeView | null;
    const bb = view?.getConnection?.()?.bbox();
    if (!bb) continue;
    extend(bb.x, bb.y, bb.width, bb.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildBoundarySpec(id: string, bbox: BBox, color: string, label: string): Node.Metadata {
  return {
    shape: BOUNDARY_SHAPE,
    id,
    x: bbox.x - BOUNDARY_PADDING,
    y: bbox.y - BOUNDARY_PADDING - LABEL_HEIGHT,
    width: bbox.width + BOUNDARY_PADDING * 2,
    height: bbox.height + BOUNDARY_PADDING * 2 + LABEL_HEIGHT,
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
        text: label,
        fill: color,
        fontSize: 11,
        fontWeight: 'bold',
        refX: BOUNDARY_PADDING,
        refY: 12,
        textAnchor: 'start',
        cursor: 'pointer',
      },
    },
  };
}
