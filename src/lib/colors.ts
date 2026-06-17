/**
 * Consolidated color tokens — single source for entity and UI colors.
 *
 * CANONICAL brand/neutral palette: the FE theme (the `@theme` ramp in
 * src/styles.css) and the dashboard charts (src/app/core/util/chart-theme.ts)
 * MIRROR these hexes. They live here, in the framework-agnostic lib, because
 * codegen/SVG-export can't read CSS custom properties. `test/brand-palette.test.ts`
 * fails the build if the styles.css `@theme` block drifts from these values.
 */

// ---------------------------------------------------------------------------
// Brand + neutral ramp (the cross-stack single source of truth)
// ---------------------------------------------------------------------------

export const BRAND = {
  cyan: '#22d3ee',       // cyan-400 — primary accent (= --color-primary)
  cyanBright: '#67e8f9', // cyan-300 — accent / hover
  sky: '#38bdf8',        // sky-400 — secondary
  deep: '#0369a1',       // sky-700 — gradient end
  ink: '#0f172a',        // slate-900 — dark surface base
  inkDeep: '#020617',    // slate-950 — darkest sections
} as const;

export const NEUTRAL = {
  slate200: '#e2e8f0', // light text on dark
  slate400: '#94a3b8', // muted labels / pipes
  slate700: '#334155', // axis / split lines
  slate800: '#1e293b', // node chip / surface fill
} as const;

// ---------------------------------------------------------------------------
// Non-entity UI colors
// ---------------------------------------------------------------------------

export const UI_COLORS = {
  pipe: NEUTRAL.slate400,  // pipe lines, visible on the dark canvas
  port: NEUTRAL.slate400,
  // Node chips are dark-themed: a slate-800 fill with a light label and the
  // entity's own colour as the stroke/icon — so they sit naturally on the dark
  // slate canvas instead of reading as bright white stickers. (Board-svg pin
  // overlays use the *_pin colours below, not these, so they're unaffected.)
  text: NEUTRAL.slate200,  // node label / port label (light on dark chip)
  bg: NEUTRAL.slate800,    // node chip fill
  selected: BRAND.sky,
  warning: '#f59e0b',   // amber-500
  error: '#ef4444',     // red-500
  water: BRAND.sky,     // water fill (used at low opacity)
  reserved: '#6b7280',  // gray-500 (board-svg pin)
  available: '#d1d5db', // gray-300 (board-svg pin)
} as const;

// ---------------------------------------------------------------------------
// Live state palette — the single visual vocabulary for the live map. The
// canvas binding maps a node's RuntimeState to exactly one of these (one
// treatment per state, applied uniformly to every kind). Not for static glyphs.
// ---------------------------------------------------------------------------

export const STATE_COLORS = {
  active: '#10b981',  // emerald-500 — running / open / flowing
  fault:  '#ef4444',  // red-500     — faulted
  warn:   '#f59e0b',  // amber-500   — caution
} as const;
