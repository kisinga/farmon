/**
 * X6 overlays that apply visual touches on top of a freshly-reset topology.
 *
 * Each helper is a small void function `(graph, …) => void`. Callers compose
 * the set they need:
 *   - Composite (site) canvases: boundaries + inter-system link styling + interconnect sizing
 *   - Per-system canvases: ghost interconnect edges + interconnect sizing
 *
 * These must run after `X6Canvas.reset(topology)` has added cells.
 */
import type { Graph, Node } from '@antv/x6';
import type { SystemTopology, LinkData } from '@far-mon/core';
import { renderBoundaries } from './boundary-renderer';

const INTERCONNECT_HEIGHT_WITH_LABEL = 66;
const INTER_SYSTEM_LINK_STROKE = '#8b5cf6';
const GHOST_OUT_STROKE = '#8b5cf6';
const GHOST_IN_STROKE = '#0891b2';

/**
 * Resize interconnect nodes that carry a connection label so the label fits
 * below the node body (interconnect.renderSvg grows from 50→66 in that case).
 */
export function resizeInterconnectCells(graph: Graph, topology: SystemTopology): void {
  for (const node of topology.nodes) {
    if (node.kind !== 'interconnect') continue;
    if (!(node as { _connectionLabel?: string })._connectionLabel) continue;
    const cell = graph.getCellById(`node-${node.id}`);
    if (cell?.isNode()) {
      const size = cell.getSize();
      if (size.height < INTERCONNECT_HEIGHT_WITH_LABEL) {
        cell.resize(size.width, INTERCONNECT_HEIGHT_WITH_LABEL);
      }
    }
  }
}

/**
 * Style the inter-system pipe edges (IDs `pipe-link-*`) as dashed violet so they
 * stand out from local pipes.
 */
export function styleInterSystemLinks(graph: Graph, links: ReadonlyArray<LinkData>): void {
  for (const link of links) {
    const edge = graph.getCellById(`pipe-link-${link.id}`);
    if (!edge?.isEdge()) continue;
    edge.setAttrs({
      line: {
        stroke: INTER_SYSTEM_LINK_STROKE,
        strokeWidth: 2,
        strokeDasharray: '8,4',
        targetMarker: { name: 'classic', size: 8 },
      },
    });
  }
}

/**
 * Apply the overlays that make a composite (site-level) canvas look right:
 * coloured boundary rects, dashed inter-system links, resized interconnects.
 */
export function renderCompositeOverlays(
  graph: Graph,
  topology: SystemTopology,
  ctx: {
    systems: ReadonlyMap<string, { topology: { device: { friendly_name: string }; nodes: ReadonlyArray<{ id: string }> } }>;
    links: ReadonlyArray<LinkData>;
  },
): void {
  const systemNodes = new Map<string, string[]>();
  const friendlyNames = new Map<string, string>();
  for (const [systemId, { topology: t }] of ctx.systems) {
    systemNodes.set(systemId, t.nodes.map(n => `${systemId}/${n.id}`));
    friendlyNames.set(systemId, t.device.friendly_name);
  }
  renderBoundaries(graph, systemNodes, friendlyNames);
  styleInterSystemLinks(graph, ctx.links);
  resizeInterconnectCells(graph, topology);
}

/**
 * Per-system overlay: add dashed ghost edges off interconnect nodes (and off
 * the pipe-peers of interconnects) so a single-system canvas still shows that
 * cross-system traffic exists.
 */
export function renderPerSystemOverlays(graph: Graph, topology: SystemTopology): void {
  resizeInterconnectCells(graph, topology);

  // Remove any stale ghost edges (idempotent across re-renders).
  for (const cell of [...graph.getCells()]) {
    if (String(cell.id).startsWith('interconnect-ghost-')) cell.remove();
  }

  // Interconnect nodes with connection metadata get their own outward/inward ghost.
  const labelled = new Map<string, 'out' | 'in'>();
  for (const node of topology.nodes) {
    if (node.kind !== 'interconnect') continue;
    const dir = (node as { _connectionDir?: 'out' | 'in' })._connectionDir;
    if (!dir) continue;
    labelled.set(node.id, dir);
    const cell = graph.getCellById(`node-${node.id}`);
    if (cell?.isNode()) addGhost(graph, cell, dir, node.id);
  }

  // Ghost on the local peer connected to each interconnect, so the flow looks
  // continuous across the system boundary.
  for (const pipe of topology.pipes) {
    const [fromId] = pipe.from.split(':');
    const [toId] = pipe.to.split(':');
    const fromDir = labelled.get(fromId);
    const toDir = labelled.get(toId);
    if (fromDir === 'out') {
      const cell = graph.getCellById(`node-${toId}`);
      if (cell?.isNode()) addGhost(graph, cell, 'in', `${toId}-from-${fromId}`);
    }
    if (toDir === 'in') {
      const cell = graph.getCellById(`node-${fromId}`);
      if (cell?.isNode()) addGhost(graph, cell, 'out', `${fromId}-from-${toId}`);
    }
  }
}

function addGhost(graph: Graph, cell: Node, side: 'out' | 'in', idSuffix: string): void {
  const pos = cell.getPosition();
  const size = cell.getSize();
  const midY = pos.y + Math.min(size.height, 50) / 2;
  if (side === 'out') {
    const startX = pos.x + size.width + 8;
    graph.addEdge({
      id: `interconnect-ghost-out-${idSuffix}`,
      source: { x: startX, y: midY },
      target: { x: startX + 60, y: midY },
      attrs: { line: ghostLineAttrs(GHOST_OUT_STROKE) },
    });
  } else {
    const endX = pos.x - 8;
    graph.addEdge({
      id: `interconnect-ghost-in-${idSuffix}`,
      source: { x: endX - 60, y: midY },
      target: { x: endX, y: midY },
      attrs: { line: ghostLineAttrs(GHOST_IN_STROKE) },
    });
  }
}

function ghostLineAttrs(stroke: string) {
  return {
    stroke,
    strokeWidth: 2.5,
    strokeDasharray: '6,4',
    strokeOpacity: 0.4,
    targetMarker: null,
    sourceMarker: null,
  };
}
