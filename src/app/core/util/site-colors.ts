/**
 * Per-name colour helpers for site visuals, shared by the admin sites catalog
 * (overview) and the customer site picker (home) so the palette lives in one
 * place. Hexes mirror the brand-adjacent Tailwind ramp.
 */

/** Stable avatar/accent palette, chosen by hash of the name. */
export const SITE_PALETTE = ['#0EA5E9', '#22D3EE', '#34D399', '#A78BFA', '#F472B6', '#FBBF24'] as const;

/** Deterministic colour from a name (stable across reloads). */
export function siteColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return SITE_PALETTE[Math.abs(hash) % SITE_PALETTE.length];
}

/** Up to two uppercase initials from a friendly name. */
export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/**
 * Positional palette for per-controller identity on the dashboard. Distinct
 * intent from SITE_PALETTE — assigned by index, not by hash — so it stays a
 * separate export even though the hexes overlap.
 */
export const CONTROLLER_PALETTE = ['#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#38bdf8'] as const;
