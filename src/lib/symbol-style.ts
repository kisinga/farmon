/**
 * Symbol design language — the single source for the visual tokens that run
 * through the WHOLE topology chain: node glyphs (`renderSvg`), the pipes that
 * connect them, the port magnets, and the labels. Colours live in `colors.ts`
 * (entity accents + state); this is the weights / radii / typography so every
 * link in the chain reads as one family instead of nine separate drawings.
 *
 * Used by the entity `renderSvg`s and by the canvas pipe/port config, so a
 * change here re-tunes the entire diagram (editor and live map alike).
 */
export const SYMBOL = {
  /** Primary outline weight — node bodies AND pipes, so the chain reads as one line. */
  stroke: 2.5,
  /** Secondary detail weight (impeller vanes, filter mesh, ripples). */
  detail: 1.6,
  /** Heavier connection stub (pump inlet/outlet nubs). */
  stub: 3,
  /** Corner radius for boxed symbols (source / endpoint / filter). */
  radius: 8,
  /** Port magnet radius. */
  port: 5,
  /** Typography for the node name and the live value readout. */
  font: { name: 12, value: 9, family: 'ui-monospace, monospace', weight: 600 },
} as const;
