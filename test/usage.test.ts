/**
 * Usage presentation helpers: the shared formatters and the by-endpoint roll-up
 * that the activity feed, the endpoint summary, and the timeframe-totals widget all
 * draw from (one formatting/aggregation owner, so they can't disagree).
 *
 * Usage: npx tsx test/usage.test.ts
 */
import { formatDurationS, formatLitres, rollupUsageByEndpoint, type UsageRunLike, type ResolvedEndpoint } from '@core';

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

// ── rollupUsageByEndpoint ─────────────────────────────────────────────────────
{
  const runs: UsageRunLike[] = [
    { controller: 'c', route: 0, duration_s: 720, delivered_l: 340, metered: true },
    { controller: 'c', route: 1, duration_s: 600, delivered_l: 160, metered: true },  // same endpoint as route 0
    { controller: 'c', route: 0, duration_s: 300, delivered_l: null, metered: false }, // unmetered: count + duration only
    { controller: 'c', route: 2, duration_s: 120, delivered_l: 50, metered: true },    // unresolved route
  ];
  const resolve = (_c: string, route: number): ResolvedEndpoint | undefined => {
    if (route === 0 || route === 1) return { id: 'tankA', name: 'Tank A' };
    return undefined; // route 2: stale/unresolved
  };
  const out = rollupUsageByEndpoint(runs, resolve);
  const tankA = out.find((e) => e.endpointId === 'tankA');
  const fallback = out.find((e) => e.endpointId === 'route:c:2');

  assert(!!tankA, 'rollup: endpoint Tank A present');
  assert(tankA!.runs === 3, 'rollup: Tank A folds 3 runs across routes 0+1', String(tankA?.runs));
  assert(tankA!.meteredRuns === 2, 'rollup: Tank A counts 2 metered runs (unmetered excluded)', String(tankA?.meteredRuns));
  assert(tankA!.litres === 500, 'rollup: Tank A litres = 340+160 (null not summed)', String(tankA?.litres));
  assert(tankA!.duration_s === 1620, 'rollup: Tank A duration = 720+600+300', String(tankA?.duration_s));
  assert(tankA!.attributable === true, 'rollup: Tank A attributable when all routes attributable');
  assert(!!fallback && fallback.runs === 1 && fallback.litres === 50, 'rollup: unresolved route gets its own bucket (not dropped)');
}
{
  // attributable=false propagates when any contributing route's meter is shared.
  const runs: UsageRunLike[] = [
    { controller: 'c', route: 0, duration_s: 60, delivered_l: 10, metered: true },
    { controller: 'c', route: 1, duration_s: 60, delivered_l: 10, metered: true },
  ];
  const resolve = (_c: string, route: number): ResolvedEndpoint =>
    route === 1 ? { id: 'tankA', name: 'Tank A', attributable: false } : { id: 'tankA', name: 'Tank A', attributable: true };
  const out = rollupUsageByEndpoint(runs, resolve);
  assert(out[0].attributable === false, 'rollup: shared-meter route marks the endpoint non-attributable');
}

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
