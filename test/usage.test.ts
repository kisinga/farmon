/**
 * Usage presentation helpers: the shared formatters and the by-endpoint roll-up
 * that the activity feed, the endpoint summary, and the timeframe-totals widget all
 * draw from (one formatting/aggregation owner, so they can't disagree).
 *
 * Usage: npx tsx test/usage.test.ts
 */
import { formatDurationS, formatLitres, rollupUsageByRoute, type UsageRunLike } from '@core';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('Usage helpers');
console.log('=============\n');

// ── formatDurationS ───────────────────────────────────────────────────────────
assert(formatDurationS(0) === '0s', 'duration 0 -> 0s', formatDurationS(0));
assert(formatDurationS(-5) === '0s', 'duration negative -> 0s', formatDurationS(-5));
assert(formatDurationS(30) === '30s', 'duration 30 -> 30s', formatDurationS(30));
assert(formatDurationS(720) === '12 min', 'duration 720 -> 12 min', formatDurationS(720));
assert(formatDurationS(3600) === '1 h', 'duration 3600 -> 1 h', formatDurationS(3600));
assert(formatDurationS(5400) === '1.5 h', 'duration 5400 -> 1.5 h', formatDurationS(5400));
assert(formatDurationS(36000) === '10 h', 'duration 36000 -> 10 h', formatDurationS(36000));

// ── formatLitres ──────────────────────────────────────────────────────────────
assert(formatLitres(null) === '', 'litres null -> ""', `"${formatLitres(null)}"`);
assert(formatLitres(undefined) === '', 'litres undefined -> ""');
assert(formatLitres(NaN) === '', 'litres NaN -> ""');
assert(formatLitres(340) === '340 L', 'litres 340 -> 340 L', formatLitres(340));
assert(formatLitres(1250) === '1,250 L', 'litres 1250 -> 1,250 L', formatLitres(1250));
assert(formatLitres(5.25) === '5.3 L', 'litres 5.25 -> 5.3 L (1 dp under 10)', formatLitres(5.25));

// ── rollupUsageByRoute ────────────────────────────────────────────────────────
{
  const runs: UsageRunLike[] = [
    { controller: 'c', route: 0, duration_s: 720, delivered_l: 340, metered: true },
    { controller: 'c', route: 0, duration_s: 600, delivered_l: 160, metered: true },  // same route, another run
    { controller: 'c', route: 0, duration_s: 300, delivered_l: null, metered: false }, // unmetered: count + duration only
    { controller: 'c', route: 1, duration_s: 120, delivered_l: 50, metered: true },    // a different route
  ];
  const name = (_c: string, route: number): string => `route ${route}`;
  const out = rollupUsageByRoute(runs, name);
  const r0 = out.find((r) => r.route === 0);
  const r1 = out.find((r) => r.route === 1);

  assert(!!r0 && r0.name === 'route 0', 'rollup: route 0 present with resolved name');
  assert(r0!.runs === 3, 'rollup: route 0 sums its 3 runs', String(r0?.runs));
  assert(r0!.meteredRuns === 2, 'rollup: route 0 counts 2 metered runs (unmetered excluded)', String(r0?.meteredRuns));
  assert(r0!.litres === 500, 'rollup: route 0 litres = 340+160 (null not summed)', String(r0?.litres));
  assert(r0!.duration_s === 1620, 'rollup: route 0 duration = 720+600+300', String(r0?.duration_s));
  assert(!!r1 && r1.runs === 1 && r1.litres === 50, 'rollup: route 1 is its own row (not folded with route 0)');
  assert(out[0].route === 0, 'rollup: sorted by litres desc (route 0 first)');
}

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
