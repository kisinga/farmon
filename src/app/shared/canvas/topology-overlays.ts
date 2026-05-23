/**
 * X6 overlays that apply visual touches on top of a freshly-reset topology.
 *
 * Each helper is a small void function `(graph, …) => void`. Callers compose
 * the set they need.
 */
import type { Graph } from '@antv/x6';
import type { SiteTopology } from '@far-mon/core';
import type { SystemTopology } from '../../core/models/topology.model';
import { renderBoundaries } from './boundary-renderer';

/**
 * Apply the overlays that make a composite (site-level) canvas look right:
 * coloured boundary rects around controller groups.
 *
 * In the anchor-mesh model, nodes are grouped by `anchorId` into controller
 * boundaries. Clicking a boundary navigates to that controller's designer.
 */
export function renderCompositeOverlays(
  graph: Graph,
  topology: SiteTopology | SystemTopology,
  ctx: {
    friendlyNames: Map<string, string>;
  },
): void {
  const systemNodes = new Map<string, string[]>();
  for (const node of topology.nodes) {
    const anchorId = (node as Record<string, unknown>)['anchorId'] as string | undefined;
    if (!anchorId) continue;
    const list = systemNodes.get(anchorId) ?? [];
    list.push(node.id);
    systemNodes.set(anchorId, list);
  }
  renderBoundaries(graph, systemNodes, ctx.friendlyNames);
}

/**
 * Per-system overlay: no-op in anchor-mesh model.
 * Previously added ghost edges for interconnect nodes.
 */
export function renderPerSystemOverlays(_graph: Graph, _topology: SiteTopology | SystemTopology): void {
  // Anchor mesh: no interconnect ghost edges needed
}
