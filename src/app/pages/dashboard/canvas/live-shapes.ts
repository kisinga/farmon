/**
 * Live-canvas node shape: a read-only SCADA glyph whose SVG sub-parts stay
 * individually targetable, so the canvas can bind live state to the descriptor's
 * `data-part` hooks (`body`/`spin`/`fill`/`gate`).
 *
 * The editor renders nodes as `shape: 'image'` with an opaque SVG data-URI
 * (`x6-shapes.ts:buildNodeConfig`) — perfect for export, but its internals are
 * a replaced-element shadow tree that CSS can't reach. Here we instead register
 * a node whose body is a bare `<g>`, then inject the descriptor's `renderSvg()`
 * output as live DOM (see `live-canvas.ts:injectGlyph`). Same SSOT glyph string,
 * different host — sub-elements become real, animatable nodes.
 *
 * Ports/pipes reuse the editor's helpers verbatim, so the diagram lays out
 * identically to the editor canvas.
 */
import { Graph } from '@antv/x6';
import type { Node } from '@antv/x6';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import { PORT_GROUPS, spacePorts, type PortItem } from '../../editor/topology-x6-tab/x6-shapes';

const LIVE_NODE_SHAPE = 'live-scada-node';

/** Selector of the empty group the descriptor SVG is injected into. */
const GLYPH_SELECTOR = 'glyph';

let registered = false;

/** Register the live node shape once (idempotent, HMR-safe via `force`). */
export function ensureLiveNodeRegistered(): void {
  if (registered) return;
  registered = true;
  Graph.registerNode(
    LIVE_NODE_SHAPE,
    {
      // Body is an empty SVG group; the glyph DOM is injected after mount.
      // `.live-glyph` lets the injected nested-<svg> overflow its 0-size box
      // without clipping and stay out of the way of port magnets.
      markup: [{ tagName: 'g', selector: GLYPH_SELECTOR }],
      attrs: { [GLYPH_SELECTOR]: { class: 'live-glyph' } },
    },
    true,
  );
}

/**
 * Node metadata for the live canvas. Mirrors `buildNodeConfig` but uses the
 * live shape (no `imageUrl`) and reuses the same port layout helpers, so pipes
 * built with `buildEdgeConfig` connect exactly as in the editor.
 */
export function buildLiveNodeConfig(
  desc: NodeDescriptor,
  id: string,
  x: number,
  y: number,
  ports: PortItem[],
  anchorId?: string,
): Node.Metadata {
  const { width, height } = desc.size;
  return {
    id: `node-${id}`,
    shape: LIVE_NODE_SHAPE,
    x,
    y,
    width,
    height,
    // `data-node-id` + `kind-<kind>` follow the frozen scada vocabulary, so the
    // glyph group is located/styled identically by the canvas (and any future
    // SVG-export / HA consumer). `state-<bucket>` is toggled live on this element.
    attrs: {
      [GLYPH_SELECTOR]: { class: `live-glyph kind-${desc.kind}`, 'data-node-id': id, 'data-kind': desc.kind },
    },
    ports: { groups: PORT_GROUPS, items: spacePorts(ports, height) },
    // The map is read-only (no click handlers), but `anchorId` rides along so the
    // shared controller-overlay renderer can group nodes by their owning controller
    // and draw the wires — exactly as the editor canvas does.
    data: { anchorId },
  };
}
