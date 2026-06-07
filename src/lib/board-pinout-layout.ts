/**
 * Pure board-pinout label layout + SVG emit — no DOM, no framework.
 *
 * Given measured connector geometry (in the board SVG's user space), produces
 * collision-free "edge callout" labels: each connected pin gets a label box
 * parked in the board's left/right margin, stacked so boxes never overlap, with
 * a leader line back to the pin. Shared by the documentation generator (baked to
 * a string at publish time) and the live editor board view.
 *
 * Everything is sized as a fraction of the board's viewBox so labels stay legible
 * regardless of the board SVG's absolute coordinate scale, and so the result
 * scales/prints correctly when the SVG is rendered responsively.
 */
import type { BoardDef } from './board.types';
import type { PinUsage } from './pin-collect';
import { entityColor } from './entity-registry';
import { escXml } from './schemas';

export interface ConnectorGeom {
  connector: string;
  /** Bounding box in the SVG's user space. */
  x: number; y: number; w: number; h: number;
}

export interface CalloutLabel {
  connector: string;
  text: string;
  color: string;
}

export interface ViewBox { x: number; y: number; width: number; height: number; }

export interface PlacedBox {
  x: number; y: number; w: number; h: number;
  text: string; color: string;
  /** Pin anchor the leader starts from. */
  pinX: number; pinY: number;
  /** Point on the box edge the leader meets. */
  connectX: number; connectY: number;
  side: 'left' | 'right';
}

export interface PinoutPlacement {
  boxes: PlacedBox[];
  /** ViewBox expanded to include the margin columns. */
  viewBox: ViewBox;
  fontSize: number;
  dotR: number;
  strokeW: number;
}

export interface LayoutOptions {
  /** Font size as a fraction of viewBox height. */
  fontRatio?: number;
  /** Truncate label text to this many characters (full text kept in a tooltip). */
  maxChars?: number;
}

/**
 * Map a controller's pin usages to callout labels: look each pin up in the board
 * to find its silkscreen connector, colour by node kind. Pins with no matching
 * board connector (off-board expander/mux channels) are dropped — they remain in
 * the documentation's text pin table.
 */
export function calloutLabelsFor(board: BoardDef, usages: PinUsage[]): CalloutLabel[] {
  const connByGpio = new Map(board.pins.map(p => [p.gpio, p.connector]));
  const out: CalloutLabel[] = [];
  for (const u of usages) {
    const connector = connByGpio.get(u.pin);
    if (!connector) continue;
    out.push({
      connector,
      text: u.fieldLabel ? `${u.nodeName} · ${u.fieldLabel}` : u.nodeName,
      color: entityColor(u.kind),
    });
  }
  return out;
}

/** Collision-free margin-column layout for connected-pin callouts. */
export function layoutCallouts(
  geoms: ConnectorGeom[],
  labels: CalloutLabel[],
  viewBox: ViewBox,
  opts: LayoutOptions = {},
): PinoutPlacement {
  const fontRatio = opts.fontRatio ?? 0.026;
  const maxChars = opts.maxChars ?? 28;

  const fontSize = viewBox.height * fontRatio;
  const charW = fontSize * 0.58;
  const padX = fontSize * 0.55;
  const swatch = fontSize * 1.1;      // room for the colour swatch at the box start
  const boxH = fontSize * 1.7;
  const gap = fontSize * 0.45;        // min vertical gap between stacked boxes
  const gutter = Math.max(viewBox.width, viewBox.height) * 0.06;
  const dotR = fontSize * 0.22;
  const strokeW = Math.max(fontSize * 0.06, viewBox.width * 0.0015);

  const geomByConn = new Map(geoms.map(g => [g.connector, g]));
  const midX = viewBox.x + viewBox.width / 2;

  interface Entry { color: string; pinX: number; pinY: number; side: 'left' | 'right'; text: string; w: number; }
  const entries: Entry[] = [];
  for (const label of labels) {
    const g = geomByConn.get(label.connector);
    if (!g) continue;
    const pinX = g.x + g.w / 2;
    const pinY = g.y + g.h / 2;
    const text = truncate(label.text, maxChars);
    entries.push({
      color: label.color,
      pinX, pinY,
      side: pinX < midX ? 'left' : 'right',
      text,
      w: swatch + text.length * charW + padX,
    });
  }

  const boxes: PlacedBox[] = [];
  for (const side of ['left', 'right'] as const) {
    const col = entries.filter(e => e.side === side).sort((a, b) => a.pinY - b.pinY);
    if (!col.length) continue;
    const colW = Math.max(...col.map(e => e.w));
    const connectX = side === 'left' ? viewBox.x - gutter : viewBox.x + viewBox.width + gutter;
    const boxX = side === 'left' ? connectX - colW : connectX;

    // Greedy de-overlap: start each box at its pin's height, push down to clear
    // the previous box. Then shift the whole column to re-centre on the pins,
    // keeping leader lines short and balanced.
    let prevBottom = -Infinity;
    const ys: number[] = [];
    for (const e of col) {
      const y = Math.max(e.pinY - boxH / 2, prevBottom + gap);
      prevBottom = y + boxH;
      ys.push(y);
    }
    const pinsCenter = (col[0].pinY + col[col.length - 1].pinY) / 2;
    const colCenter = (ys[0] + ys[ys.length - 1] + boxH) / 2;
    const shift = pinsCenter - colCenter;

    col.forEach((e, i) => {
      const y = ys[i] + shift;
      boxes.push({
        x: boxX, y, w: colW, h: boxH,
        text: e.text, color: e.color,
        pinX: e.pinX, pinY: e.pinY,
        connectX, connectY: y + boxH / 2,
        side,
      });
    });
  }

  if (!boxes.length) return { boxes, viewBox, fontSize, dotR, strokeW };

  const pad = fontSize * 0.5;
  const minX = Math.min(viewBox.x, ...boxes.map(b => b.x)) - pad;
  const maxX = Math.max(viewBox.x + viewBox.width, ...boxes.map(b => b.x + b.w)) + pad;
  const minY = Math.min(viewBox.y, ...boxes.map(b => b.y)) - pad;
  const maxY = Math.max(viewBox.y + viewBox.height, ...boxes.map(b => b.y + b.h)) + pad;
  return {
    boxes,
    viewBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    fontSize, dotR, strokeW,
  };
}

/** The callout `<g>` (leaders + boxes) for injecting into an existing `<svg>`. */
export function buildCalloutMarkup(p: PinoutPlacement): string {
  if (!p.boxes.length) return '';
  const { fontSize, dotR, strokeW } = p;
  const rx = fontSize * 0.3;
  const parts: string[] = ['<g class="pinout-callouts" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif">'];

  // Leaders + pin dots first, so the boxes paint on top.
  for (const b of p.boxes) {
    parts.push(
      `<line x1="${f(b.pinX)}" y1="${f(b.pinY)}" x2="${f(b.connectX)}" y2="${f(b.connectY)}" stroke="${b.color}" stroke-width="${f(strokeW)}" stroke-opacity="0.85" />`,
      `<circle cx="${f(b.pinX)}" cy="${f(b.pinY)}" r="${f(dotR)}" fill="${b.color}" />`,
    );
  }
  for (const b of p.boxes) {
    const cy = b.y + b.h / 2;
    parts.push(
      `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="${f(rx)}" fill="#ffffff" stroke="${b.color}" stroke-width="${f(strokeW)}" />`,
      `<circle cx="${f(b.x + fontSize * 0.62)}" cy="${f(cy)}" r="${f(fontSize * 0.3)}" fill="${b.color}" />`,
      `<text x="${f(b.x + fontSize * 1.1)}" y="${f(cy)}" font-size="${f(fontSize)}" fill="#1e293b" dominant-baseline="central">${escXml(b.text)}</text>`,
    );
  }
  parts.push('</g>');
  return parts.join('');
}

/**
 * Compose a self-contained pinout SVG string: the base board SVG re-rooted to the
 * expanded viewBox (responsive, fixed width/height stripped) with the callout
 * group appended. Returns the base SVG unchanged when there are no callouts.
 */
export function emitPinoutSvg(baseSvg: string, p: PinoutPlacement): string {
  if (!p.boxes.length) return baseSvg;
  const vb = `${f(p.viewBox.x)} ${f(p.viewBox.y)} ${f(p.viewBox.width)} ${f(p.viewBox.height)}`;
  const rerooted = baseSvg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const a = attrs
      .replace(/\sviewBox="[^"]*"/i, '')
      .replace(/\swidth="[^"]*"/i, '')
      .replace(/\sheight="[^"]*"/i, '')
      .replace(/\spreserveAspectRatio="[^"]*"/i, '');
    return `<svg${a} viewBox="${vb}" preserveAspectRatio="xMidYMid meet" width="100%">`;
  });
  const idx = rerooted.lastIndexOf('</svg>');
  if (idx === -1) return rerooted;
  return rerooted.slice(0, idx) + buildCalloutMarkup(p) + rerooted.slice(idx);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/** Compact number formatting for SVG coordinates (trim to 2 decimals). */
function f(n: number): number {
  return Math.round(n * 100) / 100;
}
