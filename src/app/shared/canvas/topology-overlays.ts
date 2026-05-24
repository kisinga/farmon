/**
 * X6 overlays that apply visual touches on top of a freshly-reset topology.
 *
 * Each helper is a small void function `(graph, …) => void`. Callers compose
 * the set they need.
 */
import type { Graph } from '@antv/x6';
import type { RenderableTopology } from '../../core/models/topology.model';
import { renderControllerOverlays, CONTROLLER_COLORS } from './controller-overlay-renderer';

export { CONTROLLER_COLORS };

/**
 * Apply the overlays that make a composite (site-level) canvas look right:
 * controller nodes above each cluster with dashed wire edges to owned nodes.
 *
 * In the anchor-mesh model, nodes are grouped by `anchorId` into controller
 * groups. Clicking a controller node navigates to that controller's designer.
 */
export function renderCompositeOverlays(
  graph: Graph,
  topology: RenderableTopology,
  ctx: {
    friendlyNames: Map<string, string>;
  },
): void {
  // Cast to SiteTopology to access controllers array
  const controllers = (topology as any).controllers as Array<{ id: string }> | undefined;
  renderControllerOverlays(graph, {
    controllers,
    friendlyNames: ctx.friendlyNames,
  });
}

/**
 * Per-system overlay: no-op in anchor-mesh model.
 * Previously added ghost edges for interconnect nodes.
 */
export function renderPerSystemOverlays(_graph: Graph, _topology: RenderableTopology): void {
  // Anchor mesh: no interconnect ghost edges needed
}
