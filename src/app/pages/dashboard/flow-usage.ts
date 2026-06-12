import type { TelemetryPoint } from '../../core/models/runtime';

/**
 * Liters used across a flow-rate series, by trapezoidal integration over the
 * points' timestamps. The rate is L/min — `value` on the raw tier, `avg` on the
 * rollup tiers (min/max would be wrong for a total, so they're ignored). This
 * replaces a device cumulative counter, which zeroed on reboot; integrating the
 * rate is reboot- and outage-immune (a gap just contributes nothing).
 *
 * Pairs with a non-finite rate or a non-increasing timestamp are skipped, so a
 * reboot reads as a gap rather than a negative — no clamp needed. Returns null
 * when fewer than two usable points span the window.
 */
export function integrateLiters(points: TelemetryPoint[]): number | null {
  let liters = 0;
  let pairs = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const r0 = rate(points[i]);
    const r1 = rate(points[i + 1]);
    const dtMin = (millis(points[i + 1]) - millis(points[i])) / 60_000; // ms → min
    if (!Number.isFinite(r0) || !Number.isFinite(r1) || !(dtMin > 0)) continue;
    liters += ((r0 + r1) / 2) * dtMin;
    pairs++;
  }
  return pairs > 0 ? liters : null;
}

/** Mean rate at a point: raw `value`, else rollup `avg`, else NaN. */
function rate(p: TelemetryPoint): number {
  return p.value ?? p.avg ?? NaN;
}

function millis(p: TelemetryPoint): number {
  return new Date(p.ts).getTime();
}
