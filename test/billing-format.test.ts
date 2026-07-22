/**
 * Billing money/volume boundary helpers (src/app/pages/billing/billing-format.ts):
 * data stays in integer minor units / millilitres; these convert at the
 * display/form boundary, so their exactness guards every billing page.
 *
 * Usage: npx tsx test/billing-format.test.ts
 */
import {
  formatMoney,
  parseMoneyToMinor,
  mlToLitres,
  formatLitres,
  fmtDate,
} from "../src/app/pages/billing/billing-format";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("Billing format helpers");
console.log("======================\n");

// --- parseMoneyToMinor: major units string → integer minor units -----------
{
  assert(parseMoneyToMinor("1500") === 150000, "whole amount");
  assert(parseMoneyToMinor("1500.50") === 150050, "two decimals");
  assert(parseMoneyToMinor("0.5") === 50, "one decimal pads to cents");
  assert(parseMoneyToMinor("1,234.56") === 123456, "thousands separator");
  assert(parseMoneyToMinor("  85.00  ") === 8500, "surrounding whitespace");
  assert(parseMoneyToMinor("0.01") === 1, "single cent");
}
{
  // Rejected inputs → null (form shows invalid, never silently mangles money).
  for (const bad of ["", "abc", "-5", "1.234", "1,2,3", ".5", "12.", "1 000", "0x10"]) {
    assert(parseMoneyToMinor(bad) === null, `rejects "${bad}"`);
  }
}

// --- formatMoney: integer minor units → 2-decimal currency string ----------
{
  const kes = formatMoney(150050, "KES");
  assert(/1,?500\.50/.test(kes), "formats 150050 as 1,500.50", `got ${kes}`);
  assert(kes.includes("KES"), "carries the currency code", `got ${kes}`);
  assert(/0\.00/.test(formatMoney(0, "KES")), "zero renders with 2 decimals");
  assert(/85\.00/.test(formatMoney(8500, "KES")), "whole amounts get .00");
}

// --- Round-trip: parse(format(x)) === x --------------------------------------
for (const minor of [0, 1, 50, 8500, 123456, 99999999]) {
  const shown = formatMoney(minor, "KES").replace(/[^\d.,-]/g, "");
  assert(parseMoneyToMinor(shown) === minor, `round-trips ${minor}`, `got ${shown}`);
}

// --- Millilitres → litres -----------------------------------------------------
{
  assert(mlToLitres(0) === 0, "0 ml");
  assert(mlToLitres(12500000) === 12500, "12,500,000 ml → 12,500 L");
  assert(mlToLitres(1499) === 1, "rounds to nearest litre (down)");
  assert(mlToLitres(1500) === 2, "rounds to nearest litre (up)");
  assert(formatLitres(12500000).includes("12,500"), "formatLitres groups thousands");
  assert(formatLitres(500).endsWith("L"), "formatLitres suffix");
}

// --- fmtDate ------------------------------------------------------------------
{
  assert(fmtDate("") === "", "empty → ''");
  assert(fmtDate("not a date") === "", "invalid → ''");
  assert(fmtDate("2026-03-01T00:00:00Z") !== "", "valid ISO renders");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
