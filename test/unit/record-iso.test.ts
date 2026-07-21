/**
 * Unit tests for the PocketBase record helpers' timestamp normalisation.
 *
 * Regression: `controllers.last_seen` reaches the dashboard presence check
 * (DashboardStore.presence) and the alert bell (AlertsStore.recompute) as a raw
 * PocketBase autodate ("YYYY-MM-DD HH:MM:SS.sssZ"). A space separator is not
 * valid ISO 8601 and Date.parse() returns NaN for it in JavaScriptCore/Safari,
 * so a live controller read as permanently offline there. `toIso` must produce
 * a string every engine parses identically.
 *
 * Usage: npx tsx test/unit/record-iso.test.ts
 */

import { toIso } from '../../src/app/core/util/record';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const PB_AUTODATE = '2026-07-20 17:53:12.773Z';
const ISO = '2026-07-20T17:53:12.773Z';

assert(toIso(PB_AUTODATE) === ISO, 'space-separated autodate becomes T-separated ISO');
assert(toIso(ISO) === ISO, 'already-ISO timestamp passes through unchanged');

const parsed = Date.parse(toIso(PB_AUTODATE));
assert(Number.isFinite(parsed), 'normalised last_seen parses to a finite timestamp');
assert(parsed === Date.UTC(2026, 6, 20, 17, 53, 12, 773), 'parsed value matches the original instant');

// Presence freshness is `now - Date.parse(last_seen) < offlineMs`; a NaN parse
// fails that check forever, so a just-stamped last_seen must evaluate as online.
const justSeen = toIso(new Date(Date.now() - 1000).toISOString().replace('T', ' '));
assert(Date.now() - Date.parse(justSeen) < 180_000, 'a just-seen controller evaluates as fresh (the offline regression)');

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
