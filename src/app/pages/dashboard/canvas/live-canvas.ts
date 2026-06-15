/**
 * Framework-agnostic, read-only "live SCADA map" canvas.
 *
 * Composes the editor's X6 helpers (ports, edges, router) and the node-glyph
 * SSOT (`NODE_REGISTRY[].renderSvg`) but is deliberately *not* `X6Canvas`: it
 * carries none of the editor's write concerns (history, snapline, connecting,
 * drag/position persistence). It draws the topology and paints two live inputs
 * onto each glyph's `data-part` hooks via one generated stylesheet: per-node
 * telemetry (`setState`) and the engaged path of running routes (`setActivePath`).
 * A node reads live when engaged OR self-active. The canvas names no kind.
 *
 * Rendering is synchronous (`async: false`): the maps are small and static, so
 * views mount on `addNode` and we can inject glyphs / apply state immediately,
 * with no render-timing dance.
 */
import { Graph } from '@antv/x6';
import type { Node } from '@antv/x6';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import type { RenderableTopology, TopologyNode } from '../../../core/models/topology.model';
import { applyStateClass, formatReading, SYMBOL, type NodeRuntime } from '@core';
import { UI_COLORS, STATE_COLORS } from '../../../core/models/colors.model';
import { buildEdgeConfig, type PortItem } from '../../editor/topology-x6-tab/x6-shapes';
import { ensureLiveNodeRegistered, buildLiveNodeConfig } from './live-shapes';

// --- One generated stylesheet: the whole live visual language ---
//
// Keyed only on the shared `state-*` classes + `[data-part]` hooks — NOT per
// kind. Every glyph reacts the same way: the body takes a state accent, a
// `spin`/`fill`/`gate` part reacts if the symbol has one, and the value label
// is styled uniformly. Adding a kind needs no CSS — only its `live` facets.

const LIVE_STYLE_ID = 'x6-live-animation';
function ensureLiveStyles(): void {
  if (document.getElementById(LIVE_STYLE_ID)) return;
  const { active, fault } = STATE_COLORS;
  const style = document.createElement('style');
  style.id = LIVE_STYLE_ID;
  style.textContent = `
@keyframes x6-spin  { to { transform: rotate(360deg); } }
@keyframes x6-flow  { to { stroke-dashoffset: -1000; } }
@keyframes x6-pulse { 50% { opacity: .45; } }
.live-glyph { overflow: visible; }

/* State accent — uniform on every kind's [data-part=body]. A glow keeps the
   entity's identity colour while signalling live/fault the same way. A node is
   live when it's engaged (on a running route) OR its own actuator is active. */
[data-part=body] { transition: filter .25s ease; }
.state-on [data-part=body], .engaged [data-part=body] { filter: drop-shadow(0 0 3.5px ${active}); }
.state-fault [data-part=body] { filter: drop-shadow(0 0 3.5px ${fault}); animation: x6-pulse 1.1s ease-in-out infinite; }
.state-unavailable { opacity: .4; }

/* Motion — live.spin. Part is drawn around its own centre, so this spins in
   place. Spins when live (engaged on a running route, or self-active). */
[data-part=spin] { transform-box: fill-box; transform-origin: center; }
.state-on [data-part=spin], .engaged [data-part=spin] { animation: x6-spin 1.1s linear infinite; }

/* Fill — live.fill. Height tracks --fill (0..1), bottom-anchored. */
[data-part=fill] { transform-box: fill-box; transform-origin: bottom; transform: scaleY(var(--fill, .5)); transition: transform .4s ease; }

/* Gate — live.gate. Recolours when open (live). Targets the part AND its child
   shapes, so a group whose paths carry their own fill/stroke still recolours. */
[data-part=gate], [data-part=gate] * { transition: fill .25s ease, stroke .25s ease, fill-opacity .25s ease; }
.state-on [data-part=gate], .state-on [data-part=gate] *,
.engaged [data-part=gate], .engaged [data-part=gate] * { fill: ${active}; stroke: ${active}; fill-opacity: .4; }

/* Value readout — overlaid by the binding; one style, hidden when empty. */
.value-label { font: 600 9px ui-monospace, monospace; fill: ${UI_COLORS.text}; text-anchor: middle; pointer-events: none; paint-order: stroke; stroke: #0f172a; stroke-width: 3px; stroke-linejoin: round; }
.value-label:empty { display: none; }`;
  document.head.appendChild(style);
}

function extractNodeData(node: TopologyNode): Record<string, unknown> {
  const { ports: _p, position: _pos, ...data } = node;
  return data;
}

/** The engaged path: the nodes + pipes of every currently-running route. An
 *  element in here is "live" regardless of its own telemetry, so the whole path
 *  lights as one unit. */
export interface ActivePath {
  nodes: Set<string>;
  pipes: Set<string>;
}

export class LiveCanvas {
  private graph: Graph;
  private nodeIds = new Set<string>();
  /** Last runtime pushed, re-applied after each render so new nodes pick it up. */
  private runtime = new Map<string, NodeRuntime>();
  /** The engaged path (nodes + pipes of running routes), re-applied after render. */
  private engaged: ActivePath = { nodes: new Set(), pipes: new Set() };
  /** What's actually on the DOM, so live updates only touch what changed (the
   *  runtime/path signals hand us fresh objects every shadow tick). The applied
   *  signature folds state + value + fill + engagement so any change repaints just that node. */
  private appliedNode = new Map<string, string>();
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
    this.appliedNode.clear();
    this.appliedFlow.clear();

    topology.nodes.forEach((node, i) => {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) return;
      const fallback = { x: (i % 4) * 160 + 50, y: Math.floor(i / 4) * 120 + 50 };
      const pos = node.position ?? fallback;
      const cell = this.graph.addNode(
        buildLiveNodeConfig(desc, node.id, pos.x, pos.y, this.portsFor(node)),
      );
      this.injectGlyph(cell, desc, extractNodeData(node));
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

  /** Push the per-node telemetry projection (state / value / fill). */
  setState(runtime: Map<string, NodeRuntime>): void {
    this.runtime = runtime;
    this.applyRuntime();
  }

  /** Push the engaged path (running routes' nodes + pipes). Lights the whole path:
   *  pipes flow, and path nodes read live even if their own telemetry is idle. */
  setActivePath(path: ActivePath): void {
    this.engaged = path;
    this.applyRuntime(); // node engagement rides the per-node paint
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
   * Inject the descriptor's SVG (its `data-part` hooks become live DOM via
   * DOMParser + importNode — namespace-correct), then, if the symbol declares
   * `live.value`, overlay a `.value-label` centred below it — placement is one
   * shared rule, not hand-coded per kind.
   */
  private injectGlyph(cell: Node, desc: NodeDescriptor, data: Record<string, unknown>): void {
    const glyph = this.graph.findViewByCell(cell)?.container.querySelector('.live-glyph');
    if (!glyph) return;
    const doc = new DOMParser().parseFromString(desc.renderSvg(data), 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName === 'parsererror') return;
    glyph.replaceChildren(document.importNode(root, true));
    if (desc.live?.value) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'value-label');
      label.setAttribute('x', String(desc.size.width / 2));
      label.setAttribute('y', String(desc.size.height + 9));
      glyph.appendChild(label);
    }
  }

  /** Paint each node's live state onto its glyph — the `state-*` class, the
   *  `engaged` class (on a running route), the `--fill` var (bounded values), and
   *  the `.value-label` readout. Skips nodes whose combined signature is unchanged,
   *  so a shadow / route tick only touches what moved. */
  private applyRuntime(): void {
    for (const id of this.nodeIds) {
      const rt = this.runtime.get(id);
      const state = rt?.state ?? 'unknown';
      const engaged = this.engaged.nodes.has(id);
      const sig = `${state}|${engaged}|${rt?.value ?? ''}|${rt?.fill ?? ''}|${rt?.unit ?? ''}`;
      if (this.appliedNode.get(id) === sig) continue;
      // The `.live-glyph` group carries `data-node-id` + `kind-*`; the live
      // `state-*` / `engaged` classes ride the same element (the scada contract).
      const glyph = this.graph.findViewByCell(`node-${id}`)?.container.querySelector('.live-glyph');
      if (!glyph) continue;
      applyStateClass(glyph, state);
      glyph.classList.toggle('engaged', engaged);
      // Reset when null so a tank that loses its reading falls back to the CSS
      // default rather than freezing at its last level.
      if (rt?.fill != null) (glyph as SVGElement).style.setProperty('--fill', String(rt.fill));
      else (glyph as SVGElement).style.removeProperty('--fill');
      const label = glyph.querySelector('.value-label');
      if (label) label.textContent = rt?.value != null ? formatReading(rt.value, rt.unit) : '';
      this.appliedNode.set(id, sig);
    }
  }

  /** Animate flowing pipes (water-tinted, marching) vs. resting (static), reusing
   *  the editor's `x6-flow` keyframe. Only edges whose flow membership flipped are
   *  rewritten, so this stays cheap on every route-state tick. */
  private applyFlow(): void {
    for (const edge of this.graph.getEdges()) {
      const pipeId = String(edge.id).replace(/^pipe-/, '');
      const flowing = this.engaged.pipes.has(pipeId);
      if (flowing === this.appliedFlow.has(pipeId)) continue;
      edge.setAttrs(flowing
        ? { line: { stroke: UI_COLORS.water, strokeWidth: SYMBOL.stroke + 0.5, strokeDasharray: 8, style: { animation: 'x6-flow 20s infinite linear' } } }
        : { line: { stroke: UI_COLORS.pipe, strokeWidth: SYMBOL.stroke, strokeDasharray: 0, style: { animation: '' } } });
      if (flowing) this.appliedFlow.add(pipeId); else this.appliedFlow.delete(pipeId);
    }
  }
}
