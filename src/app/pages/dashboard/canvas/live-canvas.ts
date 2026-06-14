/**
 * Framework-agnostic, read-only "live SCADA map" canvas.
 *
 * Composes the editor's X6 helpers (ports, edges, router) and the node-glyph
 * SSOT (`NODE_REGISTRY[].renderSvg`) but is deliberately *not* `X6Canvas`: it
 * carries none of the editor's write concerns (history, snapline, connecting,
 * drag/position persistence). It draws the topology and binds live device state
 * to CSS classes on each node's DOM — e.g. a running pump's impeller spins.
 *
 * Rendering is synchronous (`async: false`): the maps are small and static, so
 * views mount on `addNode` and we can inject glyphs / apply state immediately,
 * with no render-timing dance.
 */
import { Graph } from '@antv/x6';
import type { Node } from '@antv/x6';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import type { RenderableTopology, TopologyNode } from '../../../core/models/topology.model';
import { applyStateClass, type NodeRuntime } from '@core';
import { UI_COLORS } from '../../../core/models/colors.model';
import { buildEdgeConfig, type PortItem } from '../../editor/topology-x6-tab/x6-shapes';
import { ensureLiveNodeRegistered, buildLiveNodeConfig } from './live-shapes';

// --- One-time CSS (mirrors x6-canvas.ts `ensureFlowStyles`) ---
//
// Shared primitives only — the keyframes, base glyph rules, and the generic
// `state-*` reactions. Each kind contributes its OWN live rules via
// `descriptor.liveStyles` (composed in below), so the canvas names no kind and
// a new animation is a one-file edit in that entity's descriptor.

const LIVE_STYLE_ID = 'x6-live-animation';
function ensureLiveStyles(): void {
  if (document.getElementById(LIVE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LIVE_STYLE_ID;
  const perKind = Array.from(NODE_REGISTRY.values())
    .map((d) => d.liveStyles ?? '')
    .filter(Boolean)
    .join('\n');
  style.textContent = `
@keyframes x6-spin { to { transform: rotate(360deg); } }
@keyframes x6-flow { to { stroke-dashoffset: -1000; } }
.live-glyph { overflow: visible; }
.state-unavailable { opacity: 0.4; }
${perKind}`;
  document.head.appendChild(style);
}

function extractNodeData(node: TopologyNode): Record<string, unknown> {
  const { ports: _p, position: _pos, ...data } = node;
  return data;
}

export class LiveCanvas {
  private graph: Graph;
  private nodeIds = new Set<string>();
  /** Last runtime pushed, re-applied after each render so new nodes pick it up. */
  private runtime = new Map<string, NodeRuntime>();
  /** Pipe ids currently flowing (active route), re-applied after each render. */
  private flow = new Set<string>();
  /** What's actually on the DOM, so live updates only touch what changed (the
   *  runtime/flow signals hand us a fresh object every shadow tick). */
  private appliedState = new Map<string, NodeRuntime['state']>();
  private appliedFlow = new Set<string>();
  /** Node-set signature of the last render — refit only when the structure changes,
   *  so live updates never yank the operator's pan/zoom. */
  private lastNodeSig = '';

  constructor(container: HTMLElement) {
    ensureLiveStyles();
    ensureLiveNodeRegistered();
    this.graph = new Graph({
      container,
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      async: false,
      interacting: false, // no drag, no magnet-connect
      panning: { enabled: true, eventTypes: ['leftMouseDown'] },
      mousewheel: { enabled: true, factor: 1.1, minScale: 0.3, maxScale: 3 },
      background: { color: '#0f172a' },
      grid: { visible: true, type: 'dot', args: [{ color: '#1e293b' }] },
    });
  }

  /** Replace the rendered topology. Cheap full redraw — maps are small. */
  render(topology: RenderableTopology): void {
    this.graph.startBatch('render');
    this.graph.clearCells();
    this.nodeIds.clear();
    // Cells are gone — what we believed was applied no longer is.
    this.appliedState.clear();
    this.appliedFlow.clear();

    topology.nodes.forEach((node, i) => {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) return;
      const fallback = { x: (i % 4) * 160 + 50, y: Math.floor(i / 4) * 120 + 50 };
      const pos = node.position ?? fallback;
      const cell = this.graph.addNode(
        buildLiveNodeConfig(desc, node.id, pos.x, pos.y, this.portsFor(node)),
      );
      this.injectGlyph(cell, desc.renderSvg(extractNodeData(node)));
      this.nodeIds.add(node.id);
    });

    for (const pipe of topology.pipes) {
      const [fromNode, fromPort] = pipe.from.split(':');
      const [toNode, toPort] = pipe.to.split(':');
      if (!fromNode || !fromPort || !toNode || !toPort) continue;
      if (!this.nodeIds.has(fromNode) || !this.nodeIds.has(toNode)) continue;
      this.graph.addEdge(
        buildEdgeConfig(`pipe-${pipe.id}`, `node-${fromNode}`, fromPort, `node-${toNode}`, toPort),
      );
    }

    this.graph.stopBatch('render');
    this.applyRuntime(); // newly added nodes need current state
    this.applyFlow();

    // Refit only when the topology's node set actually changed, so a re-render
    // driven by anything else leaves the operator's pan/zoom untouched.
    const sig = [...this.nodeIds].sort().join(',');
    if (sig !== this.lastNodeSig) {
      this.lastNodeSig = sig;
      this.graph.zoomToFit({ padding: 48, maxScale: 1.4, minScale: 0.3 });
    }
  }

  /** Push the node runtime projection; toggles `state-*` classes on each glyph. */
  setState(runtime: Map<string, NodeRuntime>): void {
    this.runtime = runtime;
    this.applyRuntime();
  }

  /** Push the set of flowing pipe ids; animates those edges, resets the rest. */
  setFlow(active: Set<string>): void {
    this.flow = active;
    this.applyFlow();
  }

  resize(w: number, h: number): void {
    if (w > 0 && h > 0) this.graph.resize(w, h);
  }

  destroy(): void {
    this.graph.dispose();
  }

  // --- private ---

  /** Port layout mirrors the editor (`x6-canvas.ts:toNodeConfig`) for parity. */
  private portsFor(node: TopologyNode): PortItem[] {
    const desc = NODE_REGISTRY.get(node.kind);
    const layout = desc?.portLayout;
    return (node.ports ?? []).map((p) => {
      const group = p.direction === 'inlet' ? 'inlet' : 'outlet';
      const override = layout?.[p.id];
      if (override && desc) {
        const x = group === 'inlet' ? 0 : desc.size.width;
        return { id: p.id, group: `${group}-abs`, args: { x, y: override.y } };
      }
      return { id: p.id, group };
    });
  }

  /**
   * Inject the descriptor's SVG string into the node's `.live-glyph` group as
   * live DOM. DOMParser + importNode keeps the SVG namespace correct (more
   * robust than setting `innerHTML` on an SVG element).
   */
  private injectGlyph(cell: Node, svg: string): void {
    const glyph = this.graph.findViewByCell(cell)?.container.querySelector('.live-glyph');
    if (!glyph) return;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName === 'parsererror') return;
    glyph.replaceChildren(document.importNode(root, true));
  }

  /** Toggle each node's `state-*` class — but only where the bucket changed since
   *  last apply, so a shadow tick that moves one node doesn't touch the rest. */
  private applyRuntime(): void {
    for (const id of this.nodeIds) {
      const state = this.runtime.get(id)?.state ?? 'unknown';
      if (this.appliedState.get(id) === state) continue;
      // The `.live-glyph` group carries `data-node-id` + `kind-*`; the live
      // `state-*` class rides the same element (the scada contract).
      const glyph = this.graph.findViewByCell(`node-${id}`)?.container.querySelector('.live-glyph');
      if (glyph) {
        applyStateClass(glyph, state);
        this.appliedState.set(id, state);
      }
    }
  }

  /** Animate flowing pipes (water-tinted, marching) vs. resting (static), reusing
   *  the editor's `x6-flow` keyframe. Only edges whose flow membership flipped are
   *  rewritten, so this stays cheap on every route-state tick. */
  private applyFlow(): void {
    for (const edge of this.graph.getEdges()) {
      const pipeId = String(edge.id).replace(/^pipe-/, '');
      const flowing = this.flow.has(pipeId);
      if (flowing === this.appliedFlow.has(pipeId)) continue;
      edge.setAttrs(flowing
        ? { line: { stroke: UI_COLORS.water, strokeWidth: 3, strokeDasharray: 8, style: { animation: 'x6-flow 20s infinite linear' } } }
        : { line: { stroke: UI_COLORS.pipe, strokeWidth: 2.5, strokeDasharray: 0, style: { animation: '' } } });
      if (flowing) this.appliedFlow.add(pipeId); else this.appliedFlow.delete(pipeId);
    }
  }
}
