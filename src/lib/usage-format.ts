/**
 * Shared formatting for usage figures (run duration + delivered volume), so the
 * activity-log run suffix, the usage-by-endpoint rollup, and the dashboard
 * timeframe-totals widget all render identically. (Restores the per-figure
 * formatting that was deleted alongside flow-usage.ts in 0c51784, now sourced from
 * the durable usage ledger instead of a lossy client-side rate integral.)
 */

/** Human run duration from seconds: "0s", "45s", "12 min", "3.5 h". Compact and
 *  tabular-friendly. Non-positive / non-finite collapses to "0s". */
export function formatDurationS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${Math.round(mins)} min`;
  const hours = mins / 60;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}

/** Human delivered volume in litres: "340 L", "1,250 L", "5.3 L" (one decimal under
 *  10, thousands-separated above). Returns '' for null/undefined (an unmetered run
 *  has no volume), so callers can omit the figure rather than print "0 L". */
export function formatLitres(litres: number | null | undefined): string {
  if (litres == null || !Number.isFinite(litres)) return '';
  const v = litres < 10 ? Math.round(litres * 10) / 10 : Math.round(litres);
  return `${v.toLocaleString('en-US')} L`;
}
