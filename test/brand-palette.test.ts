/**
 * Anti-drift guard for the cross-stack colour palette.
 *
 * BRAND/NEUTRAL in src/lib/colors.ts is the single source of truth (the lib is
 * framework-agnostic, so codegen/SVG-export use it too). The FE theme mirrors it
 * in two places that can't import TS at runtime:
 *   - the `@theme` ramp in src/styles.css (CSS can't import) — checked by parsing.
 *   - the ECharts palette in chart-theme.ts — checked by importing it.
 * If any drifts from the canonical palette, this suite fails the build.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, NEUTRAL } from '@core';
import { CHART } from '../src/app/core/util/chart-theme';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'src/styles.css'), 'utf8');

/** First `--name: value;` in styles.css (the @theme definition). */
function cssVar(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not found in src/styles.css`);
  return m[1].trim().toLowerCase();
}

let failed = 0;
const check = (label: string, fn: () => void): void => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.error(`  ✗ ${label}\n    ${(e as Error).message}`); }
};

// 1. styles.css @theme ramp mirrors the canonical lib palette.
const ramp: [string, string][] = [
  ['color-brand-cyan', BRAND.cyan],
  ['color-brand-cyan-bright', BRAND.cyanBright],
  ['color-brand-sky', BRAND.sky],
  ['color-brand-deep', BRAND.deep],
  ['color-ink', BRAND.ink],
  ['color-ink-deep', BRAND.inkDeep],
];
for (const [varName, expected] of ramp) {
  check(`@theme --${varName} === ${expected}`, () => assert.equal(cssVar(varName), expected.toLowerCase()));
}

// 2. The dashboard chart palette is sourced from the canonical palette.
check('CHART.accent === BRAND.cyan', () => assert.equal(CHART.accent, BRAND.cyan));
check('CHART.axis === NEUTRAL.slate700', () => assert.equal(CHART.axis, NEUTRAL.slate700));
check('CHART.label === NEUTRAL.slate400', () => assert.equal(CHART.label, NEUTRAL.slate400));
check('CHART.text === NEUTRAL.slate200', () => assert.equal(CHART.text, NEUTRAL.slate200));

console.log(`\nbrand-palette: ${failed ? `${failed} FAILED` : 'all mirrors in sync'}`);
process.exit(failed ? 1 : 0);
