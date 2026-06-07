/**
 * Connector geometry measurement — DOM-dependent (runs in the browser only),
 * but framework-free. Reads each connector element's position from a rendered
 * board `<svg>` and maps it into the SVG's user (viewBox) space, so the layout in
 * {@link ./board-pinout-layout} can place labels in coordinates that scale and
 * print with the SVG. Connector elements are matched by id substring, the same
 * convention the board SVGs use (e.g. an element id containing "J3-7").
 */
import type { ConnectorGeom, ViewBox } from './board-pinout-layout';

/** The SVG's user-space viewBox (falls back to its intrinsic size). */
export function svgViewBox(svg: SVGSVGElement): ViewBox {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }
  const r = svg.getBoundingClientRect();
  return { x: 0, y: 0, width: r.width || 1, height: r.height || 1 };
}

/** Measure the given connectors' bounding boxes in the SVG's user space. */
export function measureConnectors(svg: SVGSVGElement, connectors: Iterable<string>): ConnectorGeom[] {
  const ctm = svg.getScreenCTM();
  if (!ctm) return [];
  const inv = ctm.inverse();
  const seen = new Set<string>();
  const out: ConnectorGeom[] = [];
  for (const connector of connectors) {
    if (seen.has(connector)) continue;
    seen.add(connector);
    const el = svg.querySelector(selectorFor(connector)) as SVGGraphicsElement | null;
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const tl = new DOMPoint(r.left, r.top).matrixTransform(inv);
    const br = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
    out.push({
      connector,
      x: Math.min(tl.x, br.x),
      y: Math.min(tl.y, br.y),
      w: Math.abs(br.x - tl.x),
      h: Math.abs(br.y - tl.y),
    });
  }
  return out;
}

function selectorFor(connector: string): string {
  // Match any element whose id contains the connector token. Quote-escape only
  // the characters that would break the attribute-substring selector.
  const safe = connector.replace(/(["\\])/g, '\\$1');
  return `[id*="${safe}"]`;
}
