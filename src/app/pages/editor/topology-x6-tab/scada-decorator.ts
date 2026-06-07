/**
 * SCADA export decorators.
 *
 * Post-processes the SVG produced by X6's `toSVG()` to add identity attributes,
 * hit rectangles, label slots, and a state/flow <style> block. Output matches
 * the farm-scada-card v1 contract (see @core ha.ts).
 */
import { NODE_REGISTRY, HA_SCHEMA_VERSION, type HaSlotSpec } from '@core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const X6_NODE_SEL = '.x6-cell.x6-node[data-cell-id]';
const X6_EDGE_SEL = '.x6-cell.x6-edge[data-cell-id]';

/** Padding around each node's bounding box for the invisible hit rectangle. */
const HIT_PADDING = 4;

/** Default y-offset below the node for an auto-injected label slot. */
const DEFAULT_LABEL_DY = 14;

/**
 * Embedded CSS applied to every exported SCADA SVG. Kept intentionally minimal —
 * the card is free to layer its own theme on top via shadow-DOM styles.
 */
export const SCADA_STYLE = `
.scada-node { transition: opacity 120ms ease; }
.scada-node .hit { cursor: pointer; }
.scada-node.state-unavailable, .scada-node.state-unknown { opacity: 0.35; }
.scada-node.state-fault { animation: scada-fault-pulse 1.4s ease-in-out infinite; }
.scada-node .label-primary { font: 600 11px ui-monospace, monospace; fill: #0f172a; pointer-events: none; }
.scada-node .label-secondary { font: 500 10px ui-monospace, monospace; fill: #475569; pointer-events: none; }
.scada-pipe .pipe-line { transition: stroke 180ms ease, stroke-opacity 180ms ease; }
.scada-pipe.flow-active .pipe-line {
  stroke: #0ea5e9;
  stroke-dasharray: 8 4;
  animation: scada-flow 1.2s linear infinite;
}
@keyframes scada-flow { to { stroke-dashoffset: -24; } }
@keyframes scada-fault-pulse {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(220, 38, 38, 0)); }
  50% { filter: drop-shadow(0 0 4px rgba(220, 38, 38, 0.7)); }
}
@media (prefers-reduced-motion: reduce) {
  .scada-pipe.flow-active .pipe-line { animation: none; stroke-dasharray: 8 4; }
  .scada-node.state-fault { animation: none; }
}
`.trim();

/**
 * Context passed in from the canvas so the decorator can look up per-node data
 * (kind, entityId, name) that isn't recoverable from the serialized SVG alone.
 */
export interface ScadaDecoratorInput {
  /** Resolve a cell id (e.g. "node-pump-1") to its payload data. */
  getCellData: (cellId: string) => Record<string, unknown> | null;
}

/**
 * Decorate an SVG in-place to match the SCADA schema v1.
 *
 * Wraps every X6 node in data attributes + class hooks, injects a hit rect,
 * emits a declared label/value slot per descriptor, and wraps every X6 edge
 * path in a `<g>` so the card can toggle `.flow-active` by pipe id.
 */
export function decorateScadaSvg(svg: SVGSVGElement, input: ScadaDecoratorInput): void {
  svg.setAttribute('data-schema-version', String(HA_SCHEMA_VERSION));

  // Prepend the style block if not already present.
  if (!svg.querySelector('style[data-scada-style]')) {
    const style = svg.ownerDocument!.createElementNS(SVG_NS, 'style');
    style.setAttribute('data-scada-style', '1');
    style.textContent = SCADA_STYLE;
    svg.insertBefore(style, svg.firstChild);
  }

  decorateNodes(svg, input);
  decorateEdges(svg, input);
}

function decorateNodes(svg: SVGSVGElement, input: ScadaDecoratorInput): void {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>(X6_NODE_SEL));
  for (const group of nodes) {
    const cellId = group.getAttribute('data-cell-id') ?? '';
    const nodeId = cellId.startsWith('node-') ? cellId.slice(5) : cellId;
    const data = input.getCellData(cellId);
    if (!data) continue;

    const kind = String(data['kind'] ?? '');
    const desc = NODE_REGISTRY.get(kind);
    if (!desc) continue;

    const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : undefined;
    const name = typeof data['name'] === 'string' ? data['name'] : undefined;

    // Identity + classes
    group.setAttribute('data-node-id', nodeId);
    group.setAttribute('data-kind', kind);
    const classes = ['scada-node', `kind-${kind}`];
    const existing = group.getAttribute('class');
    if (existing) classes.push(existing);
    group.setAttribute('class', classes.join(' '));
    if (entityId) group.setAttribute('data-entity', entityId);

    // ARIA
    group.setAttribute('role', 'button');
    if (name || entityId) {
      group.setAttribute('aria-label', name ?? entityId!);
    }

    // Hit rectangle — sized to the descriptor's bounding box + padding.
    // Injected as a first child so visuals paint on top.
    const { width, height } = desc.size;
    const hit = svg.ownerDocument!.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('class', 'hit');
    hit.setAttribute('x', String(-HIT_PADDING));
    hit.setAttribute('y', String(-HIT_PADDING));
    hit.setAttribute('width', String(width + HIT_PADDING * 2));
    hit.setAttribute('height', String(height + HIT_PADDING * 2));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    group.insertBefore(hit, group.firstChild);

    // Slot text elements. If descriptor declares slots, emit each at its
    // local-coord position. Otherwise, emit a single default label below.
    const slots = desc.slots ?? { label: defaultLabelSlot(width, height) };
    for (const [slotName, spec] of Object.entries(slots)) {
      const text = svg.ownerDocument!.createElementNS(SVG_NS, 'text');
      text.setAttribute('data-slot', slotName);
      text.setAttribute('x', String(spec.x));
      text.setAttribute('y', String(spec.y));
      text.setAttribute('text-anchor', spec.textAnchor ?? 'middle');
      text.setAttribute('class', ['label', spec.cls ?? 'label-primary'].join(' '));
      // Placeholder content — runtime replaces via binding resolver. We use an
      // em-dash so empty slots render something visible during dev.
      text.textContent = '\u2014';
      group.appendChild(text);
    }
  }
}

function decorateEdges(svg: SVGSVGElement, input: ScadaDecoratorInput): void {
  const edges = Array.from(svg.querySelectorAll<SVGGElement>(X6_EDGE_SEL));
  for (const group of edges) {
    const cellId = group.getAttribute('data-cell-id') ?? '';
    const pipeId = cellId.startsWith('pipe-') ? cellId.slice(5) : cellId;
    const data = input.getCellData(cellId);

    group.setAttribute('data-pipe-id', pipeId);
    const classes = ['scada-pipe'];
    const existing = group.getAttribute('class');
    if (existing) classes.push(existing);
    group.setAttribute('class', classes.join(' '));

    if (data) {
      if (typeof data['fromEntity'] === 'string') group.setAttribute('data-from-entity', data['fromEntity']);
      if (typeof data['toEntity'] === 'string') group.setAttribute('data-to-entity', data['toEntity']);
    }

    // Tag the primary path so the card's `.flow-active` CSS can find it.
    const path = group.querySelector<SVGPathElement>('path.x6-edge-body, path');
    if (path) {
      const pathClasses = ['pipe-line'];
      const existingPathCls = path.getAttribute('class');
      if (existingPathCls) pathClasses.push(existingPathCls);
      path.setAttribute('class', pathClasses.join(' '));
    }
  }
}

function defaultLabelSlot(_width: number, height: number): HaSlotSpec {
  return {
    x: _width / 2,
    y: height + DEFAULT_LABEL_DY,
    textAnchor: 'middle',
    cls: 'label-primary',
  };
}
