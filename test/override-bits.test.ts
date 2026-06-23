/**
 * Drift guard: the StopSpec override-mask bits (OVERRIDE_BITS in codegen-ids.ts —
 * the single TS owner) MUST match `enum OverrideBit` in the firmware kernel header,
 * and RUN_TARGET_FIELDS must build its mask only from those bits. A reordered enum
 * silently corrupts every StopSpec on both the automation and manual-run paths, so
 * pin the bit→field mapping here (the *_TOKENS arrays are pinned the same way).
 *
 * Usage: npx tsx test/override-bits.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OVERRIDE_BITS, RUN_TARGET_FIELDS } from '@core';

let passed = 0, failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('Override-bit drift guard');
console.log('========================\n');

// Firmware enum member → OVERRIDE_BITS key.
const FW_TO_TS: Record<string, keyof typeof OVERRIDE_BITS> = {
  OV_SOURCE_MIN: 'source_min',
  OV_DEST_MAX: 'dest_max',
  OV_MAX_RT: 'max_runtime',
  OV_DURATION: 'duration',
  OV_VOLUME: 'volume',
};

const coreH = fs.readFileSync(
  path.resolve(new URL('.', import.meta.url).pathname, '..', 'firmware/components/maji_control/core.h'),
  'utf8',
);
const fwBits: Record<string, number> = {};
for (const m of coreH.matchAll(/(OV_[A-Z_]+)\s*=\s*1\s*<<\s*(\d+)/g)) {
  fwBits[m[1]] = 1 << Number(m[2]);
}

assert(Object.keys(fwBits).length === 5, 'firmware enum OverrideBit has 5 members', `got ${Object.keys(fwBits).length}`);
for (const [fw, tsKey] of Object.entries(FW_TO_TS)) {
  assert(fwBits[fw] === OVERRIDE_BITS[tsKey],
    `${fw} === OVERRIDE_BITS.${tsKey} (${OVERRIDE_BITS[tsKey]})`, `firmware = ${fwBits[fw]}`);
}

// RUN_TARGET_FIELDS must use only OVERRIDE_BITS values, distinct, covering all 5.
const fieldBits = RUN_TARGET_FIELDS.map((f) => f.bit);
const allBits = new Set<number>(Object.values(OVERRIDE_BITS));
assert(new Set(fieldBits).size === fieldBits.length, 'RUN_TARGET_FIELDS bits are distinct');
assert(fieldBits.every((b) => allBits.has(b)), 'every RUN_TARGET_FIELDS.bit is an OVERRIDE_BITS value');
assert(fieldBits.length === allBits.size, 'RUN_TARGET_FIELDS covers all OVERRIDE_BITS', `${fieldBits.length} vs ${allBits.size}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
