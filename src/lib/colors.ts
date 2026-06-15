/**
 * Consolidated color tokens — single source for entity and UI colors.
 */

// ---------------------------------------------------------------------------
// Non-entity UI colors
// ---------------------------------------------------------------------------

export const UI_COLORS = {
  pipe: '#94a3b8',      // slate-400 — pipe lines, visible on the dark canvas
  port: '#94a3b8',      // slate-400
  // Node chips are dark-themed: a slate-800 fill with a light label and the
  // entity's own colour as the stroke/icon — so they sit naturally on the dark
  // slate canvas instead of reading as bright white stickers. (Board-svg pin
  // overlays use the *_pin colours below, not these, so they're unaffected.)
  text: '#e2e8f0',      // slate-200 — node label / port label (light on dark chip)
  bg: '#1e293b',        // slate-800 — node chip fill
  selected: '#38bdf8',  // sky-400
  warning: '#f59e0b',   // amber-500
  error: '#ef4444',     // red-500
  water: '#38bdf8',     // sky-400 — water fill (used at low opacity)
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
