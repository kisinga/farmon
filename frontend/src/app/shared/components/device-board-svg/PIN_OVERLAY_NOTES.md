# Pin Overlay: What Works, What Doesn't

## Goal
Show colored dots + text labels on the Fritzing breadboard SVG for assigned pins.

## What works
- Board SVG loads and renders at correct size
- Pin selection from dropdown triggers `activePinSelection` signal → pulse animation on the correct connector element via `el.style.fill` + CSS class
- `pinLabels` computed in ConfigContextService correctly maps firmware pin index → display name

## What doesn't work
- Injected `<circle>` and `<text>` SVG overlays don't appear visibly

## Approaches tried

### 1. getBBox + getCTM (element local → SVG root)
- `el.getBBox()` returns coordinates in the element's local space (e.g. `(72, 158)`)
- LoRa-E5 SVG has nested transforms: `translate(-52.7, -135.7)` then `rotate(90, 68.2, 144.5)`
- `getCTM()` should compose these, but overlays still invisible
- Possible cause: `getCTM()` may not work reliably on `innerHTML`-injected SVGs

### 2. getBoundingClientRect → viewBox mapping
- Get screen rect of pin element and SVG root, compute viewBox coords via scale ratio
- Math verified correct manually (connector1pin → ~(2.2, 13.5) in viewBox 0 0 59.7 22.8)
- Still no visible overlays

## Likely root causes to investigate
1. **Z-order / clipping**: Fritzing SVGs may have `<clipPath>` or `overflow:hidden` on parent groups that clip anything appended to `<svg>` root
2. **Opacity/visibility inheritance**: parent `<g>` elements may have opacity or display styles hiding children
3. **Wrong SVG namespace**: elements created with `createElementNS` using correct `http://www.w3.org/2000/svg` — should be fine
4. **Timing**: `requestAnimationFrame` after `innerHTML` assignment — the SVG DOM should exist by then since `domReady` signal fires after rAF

## Suggested next steps
- Open browser DevTools → inspect the `<svg>` → check if `<circle class="farmon-overlay">` elements exist in the DOM tree and what their computed position/visibility is
- If they exist but aren't visible: check for `clip-path`, `overflow`, or ancestor opacity
- If position is wrong: log `pinCenter()` return values to console
- Alternative: render labels as HTML absolutely-positioned over the SVG container instead of injecting into the SVG DOM
