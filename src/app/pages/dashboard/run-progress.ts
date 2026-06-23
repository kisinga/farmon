/**
 * Turn the device's live run facts (the snapshot route `live` block) into a progress
 * bar: a fill fraction plus a headline and a goal label. The DOMINANT axis — the one
 * nearest its stop (largest fraction) — drives both, since that is what ends the run.
 * The device reports facts; this owns the UX so it can change without reflashing.
 *
 * Level progress reuses the destination tank's live level (already on the wire) against
 * the echoed target, so no extra device field is needed for it.
 */
import type { RouteLive } from '@core';

export interface RunProgress {
  /** 0-100 fill; null = indeterminate (running, no measurable target). */
  pct: number | null;
  /** Headline for the dominant axis: "45 L" / "3:20" / "62%". */
  primary: string;
  /** The goal: "of 100 L" / "for 5:00" / "to 80%" / "until full". */
  goal: string;
  /** >= 90% — the card shifts to a success tint. */
  nearDone: boolean;
}

/** Seconds → m:ss (or h:mm past an hour). */
function clock(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}:${String(total % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * @param live           the route's `live` facts from the snapshot
 * @param destLevelPct   the destination tank's current level % (from the shadow), or null
 * @param untilFull      true when a target-less run will still stop on "full" (float valve)
 * @param startLevelPct  the dest level % captured when the run began, so level progress is
 *                       run-relative (0% at start), like the volume/time axes. Null ⇒ fall
 *                       back to absolute tank fill (current / target).
 */
export function runProgress(
  live: RouteLive,
  destLevelPct: number | null,
  untilFull: boolean,
  startLevelPct: number | null = null,
): RunProgress {
  const cands: { frac: number; primary: string; goal: string }[] = [];
  if (live.tv > 0 && live.del >= 0) {
    cands.push({ frac: live.del / live.tv, primary: `${live.del} L`, goal: `of ${live.tv} L` });
  }
  if (live.td > 0) {
    cands.push({ frac: live.dur / live.td, primary: clock(live.dur), goal: `for ${clock(live.td)}` });
  }
  if (live.tl > 0 && destLevelPct != null) {
    // Run-relative when we know the start level (0% at run open → 100% at target), else
    // the tank's absolute fill toward the target.
    const start = startLevelPct != null && startLevelPct < live.tl ? startLevelPct : 0;
    const span = live.tl - start;
    const frac = span > 0 ? (destLevelPct - start) / span : 0;
    cands.push({ frac, primary: `${Math.round(destLevelPct)}%`, goal: `to ${live.tl}%` });
  }

  if (cands.length === 0) {
    // Running with no measurable target (e.g. "until full" via a float valve).
    return {
      pct: null,
      primary: live.del >= 0 ? `${live.del} L` : clock(live.dur),
      goal: untilFull ? 'until full' : 'running',
      nearDone: false,
    };
  }

  const dom = cands.reduce((a, b) => (b.frac > a.frac ? b : a));
  const pct = Math.max(0, Math.min(100, Math.round(dom.frac * 100)));
  return { pct, primary: dom.primary, goal: dom.goal, nearDone: pct >= 90 };
}
