/**
 * MajiFlow logo — water turbine impeller with three blade-wave arms.
 *
 * `LOGO_ARTWORK` is the single source for the mark (defs + arms + hub). The
 * fixed-size `LOGO_SVG` (docs/exports) and the responsive `BRAND_LOGO_SVG`
 * (public pages, in src/app/shared/brand-logo.ts) both wrap this same artwork,
 * so a logo change happens in exactly one place.
 */
export const LOGO_ARTWORK = `<defs>
    <linearGradient id="mf1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22D3EE"/><stop offset="100%" stop-color="#0369A1"/></linearGradient>
    <linearGradient id="mf2" x1="1" y1="0.5" x2="0" y2="1"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0369A1"/></linearGradient>
    <linearGradient id="mf3" x1="0" y1="1" x2="0.5" y2="0"><stop offset="0%" stop-color="#06B6D4"/><stop offset="100%" stop-color="#0284C7"/></linearGradient>
  </defs>
  <g transform="rotate(-30)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#mf1)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#mf1)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#mf1)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <g transform="rotate(90)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#mf2)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#mf2)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#mf2)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <g transform="rotate(210)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#mf3)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#mf3)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#mf3)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <circle cx="0" cy="0" r="8" fill="#0C4A6E"/>
  <circle cx="0" cy="0" r="4.5" fill="#0EA5E9"/>
  <circle cx="0" cy="0" r="2" fill="#E0F2FE"/>`;

/** Fixed-size logo for generated docs / exports. */
export const LOGO_SVG = `<svg viewBox="-90 -90 180 180" width="120" height="120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${LOGO_ARTWORK}</svg>`;

/** Small inline logo for document headers (36px). */
export const LOGO_SVG_SMALL = LOGO_SVG.replace('width="120" height="120"', 'width="36" height="36"');
