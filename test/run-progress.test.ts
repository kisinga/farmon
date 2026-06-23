/**
 * runProgress turns the device's live run facts into the card-as-progress-bar: a fill
 * fraction + headline + goal, driven by the DOMINANT axis (the one nearest its stop).
 *
 * Usage: npx tsx test/run-progress.test.ts
 */
import { runProgress } from "../src/app/pages/dashboard/run-progress";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("run progress");
console.log("============\n");

{
  const p = runProgress({ del: 45, dur: 60, tv: 100, td: 0, tl: -1 }, null, false);
  assert(p.pct === 45, "volume: pct = del / target");
  assert(p.primary === "45 L" && p.goal === "of 100 L", "volume: labels");
}
{
  const p = runProgress({ del: -1, dur: 200, tv: 0, td: 300, tl: -1 }, null, false);
  assert(p.pct === 67, "duration: pct = elapsed / target (200/300)");
  assert(p.primary === "3:20" && p.goal === "for 5:00", "duration: clock labels");
}
{
  const p = runProgress({ del: -1, dur: 10, tv: 0, td: 0, tl: 80 }, 62, false);
  assert(p.pct === 78, "level (no start): absolute fill, dest level / target (62/80)");
  assert(p.primary === "62%" && p.goal === "to 80%", "level: labels (live dest level)");
}
{
  // run-relative: started at 50%, now 62%, target 80% → (62-50)/(80-50) = 40%.
  const p = runProgress({ del: -1, dur: 10, tv: 0, td: 0, tl: 80 }, 62, false, 50);
  assert(p.pct === 40, "level (with start): run-relative (62-50)/(80-50)");
}
{
  // volume 45% vs duration 67% → duration is nearest its stop, so it drives the bar.
  const p = runProgress({ del: 45, dur: 200, tv: 100, td: 300, tl: -1 }, null, false);
  assert(p.pct === 67 && p.goal === "for 5:00", "dominant = nearest stop (max fraction)");
}
{
  const p = runProgress({ del: 30, dur: 60, tv: 0, td: 0, tl: -1 }, null, true);
  assert(p.pct === null, "no target → indeterminate");
  assert(p.primary === "30 L" && p.goal === "until full", "indeterminate: until-full label");
}
{
  assert(runProgress({ del: 95, dur: 0, tv: 100, td: 0, tl: -1 }, null, false).nearDone === true, "nearDone at 95%");
  assert(runProgress({ del: 120, dur: 0, tv: 100, td: 0, tl: -1 }, null, false).pct === 100, "clamps to 100%");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
