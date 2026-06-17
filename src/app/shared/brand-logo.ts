import { LOGO_ARTWORK } from '../../lib/static/logo';

/**
 * MajiFlow brand mark, responsive (fills its container) — for the public pages
 * (landing, login, nav). Wraps the canonical artwork in src/lib/static/logo.ts
 * so the mark is defined once. Static and trusted; render it through
 * `DomSanitizer.bypassSecurityTrustHtml` because Angular strips inline SVG from
 * `[innerHTML]` otherwise.
 */
export const BRAND_LOGO_SVG = `<svg viewBox="-90 -90 180 180" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">${LOGO_ARTWORK}</svg>`;
