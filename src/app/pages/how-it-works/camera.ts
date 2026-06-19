/**
 * Camera framing math for the simulation scene. Pure functions: they take a
 * desktop {@link Cam} or a mobile {@link MBox} plus the viewport size and return
 * the CSS `transform` string for the `#world` group. No DOM, no state.
 *
 *   Desktop: the scene meet-fits the viewport and the camera pans/zooms it,
 *            centring the focus point (fx,fy) at scale s.
 *   Mobile:  the scene slice-fits (full-bleed cover) and the camera fits a
 *            per-stage world region into the band above the caption, so each beat
 *            reads large instead of being crushed into the full 2.6:1 width.
 */
import { WORLD, type Cam, type MBox } from './stages';

const { w: W, h: H } = WORLD;

/** Desktop: centre the focus point at scale s within the meet-fitted viewport. */
export function frameDesktop(c: Cam): string {
  const tx = W / 2 - c.s * c.fx;
  const ty = H / 2 - c.s * c.fy;
  return `translate(${tx}px,${ty}px) scale(${c.s})`;
}

/** The implicit mobile region for a desktop cam that has no explicit MBox. */
export function defaultBox(c: Cam): MBox {
  return { x: c.fx - 320, y: c.fy - 280, w: 640, h: 560 };
}

/** Mobile: fit a world region into the usable band above the caption (slice-fit svg). */
export function frameMobileBox(box: MBox, vw: number, vh: number): string {
  const ss = Math.max(vw / W, vh / H); // SVG slice (cover) scale
  // usable band: leave room for the header (top) and caption + transport (bottom)
  const headerH = 84;
  const bottomReserve = Math.min(vh * 0.48, 360);
  const usableTop = headerH;
  const usableH = Math.max(150, vh - bottomReserve - usableTop);
  const usableW = vw - 24;
  const sCam = 0.92 * Math.min(usableW / (box.w * ss), usableH / (box.h * ss));
  const bx = box.x + box.w / 2;
  const by = box.y + box.h / 2;
  const cy = usableTop + usableH / 2; // screen y to place the focal center
  const Uy = H / 2 + (cy - vh / 2) / ss; // -> user-space landing point
  const tx = W / 2 - sCam * bx;
  const ty = Uy - sCam * by;
  return `translate(${tx}px,${ty}px) scale(${sCam})`;
}
