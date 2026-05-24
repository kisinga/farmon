/**
 * TopologyRenderer — "render a topology on a hidden canvas and capture its SVG."
 *
 * Owns a single X6Canvas in a caller-provided container. Successive calls to
 * `export()` reuse the same graph (reset → overlays → RAF wait → toSVG), so
 * there is no cross-render contamination and only one place knows about the
 * paint-cycle timing.
 */
import type { HaMeta, SystemTopology } from '@far-mon/core';
import type { RenderableTopology } from '../../core/models/topology.model';
import { NODE_REGISTRY, buildHaMeta } from '@far-mon/core';
import { X6Canvas, type CanvasEvents } from '../../pages/editor/topology-x6-tab/x6-canvas';

// HaMeta is referenced in the exportHa return type.
export type { HaMeta };

const CANVAS_PADDING = 200;
const MIN_CANVAS_SIZE = 400;

/** Mutator run after `reset()` has added cells and before SVG is captured. */
export type TopologyOverlay = (canvas: X6Canvas, topology: RenderableTopology) => void;

const NOOP_EVENTS: CanvasEvents = {
  onNodesMoved: () => {},
  onPipeCreated: () => {},
  onPipeDeleted: () => {},
  onSelected: () => {},
  onDanglingPipe: () => {},
};

export class TopologyRenderer {
  private readonly canvas: X6Canvas;

  constructor(container: HTMLElement) {
    // Sync rendering: addNode/addEdge mount their views immediately, so toSVG
    // never sees a half-painted graph. No grid/background: docs SVG stays
    // transparent with no dotted pattern. Canvas is resized per-export to
    // match the topology's content bbox — avoids wasted paint area.
    this.canvas = new X6Canvas(container, NOOP_EVENTS, { async: false, grid: false, background: false });
    this.canvas.setReadonly(true);
    this.canvas.resize(MIN_CANVAS_SIZE, MIN_CANVAS_SIZE);
  }

  /**
   * Render the given topology on the hidden canvas, apply any overlays, then
   * serialize the canvas to a standalone SVG string at natural coordinates.
   * The canvas is sized to fit the topology's bounding box plus a safety
   * margin, so all cells render without wasting offscreen paint area.
   */
  async export(topology: RenderableTopology, overlays: ReadonlyArray<TopologyOverlay> = []): Promise<string> {
    const { width, height } = canvasSizeFor(topology);
    this.canvas.resize(width, height);

    const graph = this.canvas.graphInstance;
    graph.clearCells();
    graph.scale(1, 1);
    graph.translate(0, 0);
    this.canvas.render(topology);
    for (const overlay of overlays) overlay(this.canvas, topology);
    // One extra frame: X6 flushes any router/edge-geometry recomputations that
    // were queued during synchronous cell mounting.
    await nextPaint();
    return this.canvas.exportSvg(measureStageViewBox(graph));
  }

  /**
   * Export the topology as a (decorated SVG, meta sidecar) pair matching the
   * SCADA v1 contract consumed by farm-scada-card.
   *
   * Behavior:
   *  - SVG is wrapped with `data-node-id`/`data-pipe-id`/`data-kind`/class hooks,
   *    hit rects, label slots, and a state+flow <style> block.
   *  - Meta carries per-node entityId + resolved actions + bind expressions,
   *    and per-pipe endpoint entity refs + flow predicate.
   *  - Output is deterministic: nodes and pipes iterate in sorted order; coords
   *    are rounded.
   *  - Throws if a node declares a `binds` key whose slot isn't emitted in the
   *    SVG (catches drift between descriptor slots and meta bindings early).
   */
  async exportHa(topology: SystemTopology): Promise<{ svg: string; meta: HaMeta }> {
    const { width, height } = canvasSizeFor(topology);
    this.canvas.resize(width, height);

    const graph = this.canvas.graphInstance;
    graph.clearCells();
    graph.scale(1, 1);
    graph.translate(0, 0);
    this.canvas.render(topology);
    await nextPaint();

    const viewBox = measureStageViewBox(graph);
    const svg = await this.canvas.exportSvg(viewBox, { scada: true });

    const vbTuple: [number, number, number, number] = viewBox
      ? [round(viewBox.x), round(viewBox.y), round(viewBox.width), round(viewBox.height)]
      : [0, 0, round(width), round(height)];

    const meta = buildHaMeta(topology, { viewBox: vbTuple });
    return { svg, meta };
  }

  destroy(): void {
    this.canvas.destroy();
  }
}

function round(n: number): number { return Math.round(n); }

/** Compute hidden-canvas dimensions that contain the topology + margin. */
function canvasSizeFor(topology: RenderableTopology): { width: number; height: number } {
  if (topology.nodes.length === 0) return { width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE };
  let maxX = 0, maxY = 0;
  for (const node of topology.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    const w = desc?.size.width ?? 120;
    const h = desc?.size.height ?? 60;
    if (node.position.x + w > maxX) maxX = node.position.x + w;
    if (node.position.y + h > maxY) maxY = node.position.y + h;
  }
  return {
    width: Math.max(MIN_CANVAS_SIZE, maxX + CANVAS_PADDING),
    height: Math.max(MIN_CANVAS_SIZE, maxY + CANVAS_PADDING),
  };
}

/**
 * Measure the live stage group's bbox (includes router-generated path geometry
 * that `graph.getContentBBox()` misses). Returns `undefined` for empty stages
 * so callers fall back to X6's default viewBox logic.
 */
function measureStageViewBox(graph: { container: HTMLElement }): { x: number; y: number; width: number; height: number } | undefined {
  const stage = graph.container.querySelector('.x6-graph-svg-stage') as SVGGraphicsElement | null;
  if (!stage) return undefined;
  const bb = stage.getBBox();
  if (bb.width === 0 || bb.height === 0) return undefined;
  const PAD = 8;
  return { x: bb.x - PAD, y: bb.y - PAD, width: bb.width + PAD * 2, height: bb.height + PAD * 2 };
}

/**
 * Wait for X6's async view rendering to commit. One frame stages the layout;
 * the second frame ensures all setAttr/resize side-effects from overlays are
 * flushed before `toSVG()` serializes the DOM.
 */
function nextPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
