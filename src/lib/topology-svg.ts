/**
 * Static, dependency-free topology renderer: a SiteTopology to one inline SVG
 * string, using each node's registry glyph (`NodeDescriptor.renderSvg`) at its
 * stored position, drawing pipes as curves between them, and labelling a key of
 * the node kinds present.
 *
 * Deliberately NOT the editor's X6 canvas: no interactivity, no layout engine,
 * no framework. It reuses only the glyph SSOT, so it is safe on a public page and
 * embeddable in the documentation flow (the quote's `diagrams` slot). The SVG
 * carries its own dark background (the app's darkest surface) so the dark-themed
 * glyphs read on any surface.
 */
import { NODE_REGISTRY, legendSvgFor, type NodeDescriptor } from './entity-registry';
import type { SiteTopology } from './topology.types';
import { UI_COLORS, BRAND, NEUTRAL } from './colors';
import { escXml } from './schemas';

interface Geo { x: number; y: number; w: number; h: number; cx: number; cy: number; }

/** Node id of a `"nodeId:port"` endpoint reference. */
function refNode(ref: string): string {
  return ref.split(':', 1)[0];
}

export interface TopologySvgOptions {
  /** Outer padding around the diagram, in glyph units (default 28). */
  padding?: number;
  /** Render the node-kind key below the diagram (default true). */
  legend?: boolean;
}

/**
 * Render a topology to an inline SVG string, or `''` if it has no positioned
 * nodes. Positions come from the topology (the composer assigns them); flow runs
 * left to right, so pipes leave a node's right edge and enter the next on the left.
 */
export function renderTopologySvg(topo: Pick<SiteTopology, 'nodes' | 'pipes'>, opts: TopologySvgOptions = {}): string {
  const pad = opts.padding ?? 28;
  const withLegend = opts.legend ?? true;

  const geo = new Map<string, Geo>();
  for (const n of topo.nodes) {
    const d = NODE_REGISTRY.get(n.kind);
    if (!d) continue;
    const { width: w, height: h } = d.size;
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    geo.set(n.id, { x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
  }
  if (geo.size === 0) return '';

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of geo.values()) {
    minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
  }
  const dx = pad - minX, dy = pad - minY;
  const contentH = maxY - minY;
  const vbW = (maxX - minX) + pad * 2;

  const edges = topo.pipes.map(p => {
    const a = geo.get(refNode(p.from));
    const b = geo.get(refNode(p.to));
    if (!a || !b) return '';
    const x1 = a.x + a.w + dx, y1 = a.cy + dy;
    const x2 = b.x + dx, y2 = b.cy + dy;
    const c = Math.max(24, (x2 - x1) / 2);
    return `<path class="pipe" d="M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}" fill="none" stroke="${UI_COLORS.pipe}" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');

  const glyphs = topo.nodes.map(n => {
    const d = NODE_REGISTRY.get(n.kind);
    const g = geo.get(n.id);
    if (!d || !g) return '';
    return `<g transform="translate(${g.x + dx},${g.y + dy})">${d.renderSvg(n as unknown as Record<string, unknown>)}</g>`;
  }).join('');

  // --- Node-key legend: the actual node icons (same glyphs the editor uses via
  // legendSvgFor), one per kind present, with its label. ---
  let legend = '';
  let bottom = pad + contentH;
  if (withLegend) {
    const ICON_H = 34, ICON_SCALE = ICON_H / 16, GAP = 24, ROW_H = 48, CHAR_W = 8.2, FONT = 15;
    const seen = new Set<string>();
    const items: NodeDescriptor[] = [];
    for (const n of topo.nodes) {
      if (seen.has(n.kind)) continue;
      seen.add(n.kind);
      const d = NODE_REGISTRY.get(n.kind);
      if (d) items.push(d);
    }
    const sepY = pad + contentH + 16;
    legend += `<line x1="${pad}" y1="${sepY}" x2="${vbW - pad}" y2="${sepY}" stroke="${NEUTRAL.slate700}" stroke-width="1"/>`;
    let lx = pad, ly = sepY + 30;
    const maxRight = vbW - pad;
    for (const d of items) {
      // legendSvgFor renders the glyph (no name text) at 16px tall; scale it up.
      const iconW = (d.size.width * ICON_H) / d.size.height;
      const itemW = iconW + 8 + d.label.length * CHAR_W;
      if (lx > pad && lx + itemW > maxRight) { lx = pad; ly += ROW_H; }
      legend += `<g transform="translate(${lx}, ${ly - ICON_H / 2}) scale(${ICON_SCALE})">${legendSvgFor(d)}</g>`
        + `<text x="${lx + iconW + 8}" y="${ly}" font-size="${FONT}" font-family="ui-sans-serif, system-ui, sans-serif" fill="${UI_COLORS.text}" dominant-baseline="middle">${escXml(d.label)}</text>`;
      lx += itemW + GAP;
    }
    bottom = ly + ICON_H / 2;
  }
  const vbH = bottom + pad;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" style="display:block;width:100%;height:auto" role="img" aria-label="System topology">`
    + `<rect x="0" y="0" width="${vbW}" height="${vbH}" rx="14" fill="${BRAND.inkDeep}"/>`
    + edges + glyphs + legend
    + `</svg>`;
}
