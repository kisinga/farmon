/**
 * integrateLiters: a flow widget's windowed usage = the trapezoidal integral of
 * its rate series (L/min over time). This replaced a device cumulative counter
 * that zeroed on reboot; the guard here is the reboot-immunity property — a
 * mid-window drop to 0 reads as the real partial usage, never a negative, with no
 * counter delta to subtract.
 *
 * Usage: npx tsx test/flow-usage.test.ts
 */
import { integrateLiters } from "../src/app/pages/dashboard/flow-usage";
import type { TelemetryPoint } from "../src/app/core/models/runtime";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const T0 = Date.parse("2026-06-12T00:00:00Z");
/** Raw-tier point: instantaneous rate (L/min) at minute offset `min`. */
const raw = (min: number, value: number): TelemetryPoint =>
  ({ ts: new Date(T0 + min * 60_000).toISOString(), value });
/** Rollup-tier point: bucket mean rate (L/min); min/max present but unused. */
const agg = (min: number, avg: number): TelemetryPoint =>
  ({ ts: new Date(T0 + min * 60_000).toISOString(), avg, min: 0, max: avg });

// Flat 10 L/min for 60 min → 600 L (raw tier).
assert(integrateLiters([raw(0, 10), raw(60, 10)]) === 600, "flat rate raw tier = rate × minutes");

// Same on the rollup tier — integrates `avg`, ignores min/max.
assert(integrateLiters([agg(0, 10), agg(60, 10)]) === 600, "flat rate rollup tier uses avg");

// Reboot mid-window: 10,10,0,0 at 30-min steps = 300 + 150 + 0 = 450 L.
// Positive, never negative, no clamp.
assert(integrateLiters([raw(0, 10), raw(30, 10), raw(60, 0), raw(90, 0)]) === 450,
  "drop-to-0 (reboot) integrates the real partial usage");

// Triangular ramp 0→20 over 60 min → mean 10 → 600 L (area, not endpoint).
assert(integrateLiters([raw(0, 0), raw(60, 20)]) === 600, "ramp integrates by area");

// Too few usable points → null.
assert(integrateLiters([]) === null, "empty series → null");
assert(integrateLiters([raw(0, 10)]) === null, "single point → null");

// Non-finite rate / zero-width step are skipped (no NaN leak).
assert(integrateLiters([{ ts: new Date(T0).toISOString() }, raw(60, 10)]) === null,
  "point with no value/avg → skipped → null");
assert(integrateLiters([raw(0, 10), raw(0, 10)]) === null, "zero-duration step → null");

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
