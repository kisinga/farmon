/**
 * Tank calibration translation: deriveTankCalibration ↔ tankCalibrationToPhysical
 * must round-trip, so the operator UI can edit in physical terms, write psi anchors
 * to the device, and reconcile the device's psi back to physical without drift.
 *
 * Usage: npm run test:calibration
 */
import { deriveTankCalibration, tankCalibrationToPhysical, PSI_PER_M } from "@core";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log("Tank calibration translation");
console.log("============================\n");

// Known anchors: empty = head below the tank; full = that head + the column.
{
  const cal = deriveTankCalibration(2, 1); // height 2 m, sensor 1 m below outlet
  assert(close(cal.p_empty_psi, PSI_PER_M * 1), "empty psi = PSI_PER_M · elevation");
  assert(close(cal.p_full_psi, PSI_PER_M * 3), "full psi = PSI_PER_M · (elevation + height)");
  assert(close(cal.working_span_psi, PSI_PER_M * 2), "span psi = PSI_PER_M · height");
}

// Round-trip: physical → psi → physical recovers the inputs.
for (const [h, e] of [[3, 0.5], [1.2, 0], [5, 2], [0.75, 1.3]] as const) {
  const cal = deriveTankCalibration(h, e);
  const phys = tankCalibrationToPhysical(cal.p_empty_psi, cal.p_full_psi);
  assert(close(phys.tank_height_m, h) && close(phys.elevation_m, e), `round-trip height=${h} drop=${e}`,
    `got height=${phys.tank_height_m} drop=${phys.elevation_m}`);
}

// Inverse from arbitrary device anchors is consistent with the forward derivation.
{
  const phys = tankCalibrationToPhysical(1.42233, 5.68932); // ~1m drop, ~3m span
  const back = deriveTankCalibration(phys.tank_height_m, phys.elevation_m);
  assert(close(back.p_empty_psi, 1.42233) && close(back.p_full_psi, 5.68932, 1e-6), "device psi → physical → psi is stable");
}

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
