/**
 * Scaling limits tests: vary manifest parameters to find hard ceilings
 * in the codegen, validator, and generated firmware.
 *
 * Usage: npm run test:limits
 */

import * as path from "node:path";
import type { Manifest } from "../electron/lib/schema.js";
import { runManifestRules } from "../electron/lib/validate.js";
import { generateAll } from "../electron/lib/generate.js";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const board: BoardDef = loadBoard(path.join(DEFAULTS, "boards/heltec-v3"));

// --- GPIO pin pool (free pins on Heltec V3) ---
// Must match board.yaml exposed pins — excludes reserved pins
// (LoRa: GPIO8/9/10/11/12/13/14, OLED: GPIO21, I2C: GPIO17/18,
//  Battery: GPIO1/37, LED: GPIO35, Vext: GPIO36)
const FREE_PINS = [
  2, 3, 4, 5, 6, 7, 19, 20, 26, 33, 34,
  38, 39, 40, 41, 42, 45, 46, 47, 48,
];

function pin(i: number): string {
  if (i < FREE_PINS.length) return `GPIO${FREE_PINS[i]}`;
  return `GPIO${50 + i}`; // virtual — validator will catch ADC issues
}

// --- Manifest builder ---

interface ScaleParams {
  tanks: number;
  valves: number;
  flows: number;
  routes: number;
}

function buildManifest(p: ScaleParams): Manifest {
  let pinIdx = 0;
  const pumpPin = pin(pinIdx++);

  // Ensure at least 1 flow sensor (schema requires it)
  const flowCount = Math.max(p.flows, 1);

  const tanks = Array.from({ length: p.tanks }, (_, i) => ({
    name: `Tank ${i + 1}`,
    id: `tank${i + 1}`,
  }));

  const valves = Array.from({ length: p.valves }, (_, i) => ({
    name: `Valve ${i + 1}`,
    id: `valve${i + 1}`,
    open_pin: pin(pinIdx++),
    close_pin: pin(pinIdx++),
  }));

  const flows = Array.from({ length: flowCount }, (_, i) => ({
    name: `Flow ${i + 1}`,
    id: `flow${i + 1}`,
    pin: pin(pinIdx++),
    flow_cal: 450,
  }));

  const routes: Array<Record<string, unknown>> = [];
  for (let r = 0; r < p.routes && routes.length < p.routes; r++) {
    const srcIdx = r % p.tanks;
    const v1Idx = r % p.valves;
    const v2Idx = (r + 1) % p.valves;
    const isRefill = r % 3 === 0 && p.tanks > 1;
    const dstIdx = isRefill ? (srcIdx + 1) % p.tanks : undefined;
    if (dstIdx === srcIdx) continue;

    const routeValves =
      v1Idx === v2Idx
        ? [`valve${v1Idx + 1}`]
        : [`valve${v1Idx + 1}`, `valve${v2Idx + 1}`];

    // Every route requires a flow sensor — no watchdog field
    routes.push({
      name: isRefill
        ? `R${r}:T${srcIdx + 1}>T${dstIdx! + 1}`
        : `R${r}:T${srcIdx + 1}>E`,
      source: `tank${srcIdx + 1}`,
      source_type: "tank",
      ...(isRefill ? { destination: `tank${dstIdx! + 1}` } : {}),
      valves: routeValves,
      flow_sensor: `flow${(r % flowCount) + 1}`,
      max_runtime_seconds: isRefill ? 600 : 1800,
    });
  }

  // Build flat nodes array (new manifest shape)
  const nodes = [
    { kind: 'pump', id: 'pump1', name: 'Pump', pin: pumpPin },
    ...tanks.map(t => ({ kind: 'tank' as const, ...t })),
    ...valves.map(v => ({ kind: 'valve' as const, ...v })),
    ...flows.map(f => ({ kind: 'flow_sensor' as const, ...f })),
  ];

  const defaultRoute: Manifest["routes"][number] = {
    key: "tank1>endpoint", name: "R0", source: "tank1", source_type: "tank" as const,
    valves: ["valve1"], flow_sensor: "flow1", max_runtime_seconds: 1800,
    needs_pump: true, nodeSequence: ["tank1", "valve1", "pump1", "flow1", "endpoint"],
  };

  return {
    device: { name: "limit-test", friendly_name: "Limit Test", board: "heltec-v3" },
    nodes,
    routes: routes.length > 0
      ? (routes as Manifest["routes"]).map(r => ({ ...r, key: `${r.source}>${r.destination ?? 'endpoint'}`, needs_pump: true, nodeSequence: [] }))
      : [defaultRoute],
    timing: {
      valve_travel_time: 15,
      flow_watchdog: 30,
      flow_confirm: 15,
      flow_threshold: 0.5,
      api_watchdog: 300,
      update_interval: 5,
    },
    automations: [],
  };
}

// --- Test runner ---

interface TestResult {
  label: string;
  pins: number;
  routes: number;
  parseOk: boolean;
  validateOk: boolean;
  generateOk: boolean;
  errors: string[];
  warnings: string[];
  routesHLines?: number;
}

function runTest(label: string, p: ScaleParams): TestResult {
  const flowCount = Math.max(p.flows, 1);
  const manifest = buildManifest(p);
  const result: TestResult = {
    label,
    pins: 1 + p.tanks + p.valves * 2 + flowCount,
    routes: manifest.routes.length,
    parseOk: true,
    validateOk: false,
    generateOk: false,
    errors: [],
    warnings: [],
  };

  const v = runManifestRules(manifest, board, undefined, { loose: true });
  result.validateOk = v.ok;
  result.warnings = v.warnings;
  result.errors = v.errors;
  if (!v.ok) return result;

  try {
    const files = generateAll(manifest, board, 'test-site');
    result.generateOk = true;
    const rh = files.find((f) => f.relativePath.endsWith("routes.h"));
    if (rh) result.routesHLines = rh.content.split("\n").length;
  } catch (err) {
    result.errors.push(String(err));
  }

  return result;
}

// --- Output ---

function printResult(r: TestResult) {
  const status = r.generateOk ? "OK" : r.validateOk ? "GEN-FAIL" : r.parseOk ? "VAL-FAIL" : "PARSE-FAIL";
  const warn = r.warnings.length > 0 ? ` (${r.warnings.length} warn)` : "";
  console.log(
    `  ${status.padEnd(10)} ${r.label.padEnd(35)} pins=${String(r.pins).padEnd(4)} routes=${String(r.routes).padEnd(4)} h=${String(r.routesHLines ?? "-").padEnd(5)}${warn}`
  );
  for (const e of r.errors.slice(0, 2)) {
    console.log(`             \u2717 ${e}`);
  }
  if (r.errors.length > 2) console.log(`             ... +${r.errors.length - 2} more`);
}

function suite(name: string, tests: TestResult[]) {
  console.log(`\n\u2501\u2501\u2501 ${name} \u2501\u2501\u2501`);
  for (const t of tests) printResult(t);
  const lastOk = [...tests].reverse().find((t) => t.generateOk);
  const firstFail = tests.find((t) => !t.generateOk);
  if (lastOk && firstFail) {
    console.log(`  \u2192 Max: ${lastOk.label} | Fails at: ${firstFail.label}`);
  } else if (tests.every((t) => t.generateOk)) {
    console.log(`  \u2192 All passed through ${tests[tests.length - 1].label}`);
  }
}

// --- Suites ---

let totalPass = 0;
let totalFail = 0;

function run(name: string, configs: Array<[string, ScaleParams]>) {
  const results = configs.map(([label, p]) => runTest(label, p));
  suite(name, results);
  totalPass += results.filter((r) => r.generateOk).length;
  totalFail += results.filter((r) => !r.generateOk).length;
}

console.log("Scaling Limits Tests");
console.log("====================\n");

run("Tanks (4 valves, 2 flows)", [
  ["1 tank", { tanks: 1, valves: 4, flows: 2, routes: 2 }],
  ["4 tanks", { tanks: 4, valves: 4, flows: 2, routes: 8 }],
  ["10 tanks", { tanks: 10, valves: 4, flows: 2, routes: 20 }],
  ["15 tanks", { tanks: 15, valves: 4, flows: 2, routes: 20 }],
]);

run("Valves (2 tanks, 2 flows)", [
  ["4 valves", { tanks: 2, valves: 4, flows: 2, routes: 4 }],
  ["8 valves", { tanks: 2, valves: 8, flows: 2, routes: 8 }],
  ["16 valves", { tanks: 2, valves: 16, flows: 2, routes: 10 }],
  ["17 valves", { tanks: 2, valves: 17, flows: 2, routes: 10 }],
  ["20 valves", { tanks: 2, valves: 20, flows: 2, routes: 10 }],
]);

run("Flow sensors (2 tanks, 4 valves)", [
  ["1 flow", { tanks: 2, valves: 4, flows: 1, routes: 4 }],
  ["4 flows", { tanks: 2, valves: 4, flows: 4, routes: 4 }],
  ["10 flows", { tanks: 2, valves: 4, flows: 10, routes: 4 }],
]);

run("Routes (4 tanks, 8 valves, 4 flows)", [
  ["5 routes", { tanks: 4, valves: 8, flows: 4, routes: 5 }],
  ["20 routes", { tanks: 4, valves: 8, flows: 4, routes: 20 }],
  ["50 routes", { tanks: 4, valves: 8, flows: 4, routes: 50 }],
]);

run("Proportional N (N tanks, 2N valves, N flows, N\u00b2 routes)", [
  ["N=2", { tanks: 2, valves: 4, flows: 2, routes: 4 }],
  ["N=4", { tanks: 4, valves: 8, flows: 4, routes: 16 }],
  ["N=6", { tanks: 6, valves: 12, flows: 6, routes: 36 }],
  ["N=8", { tanks: 8, valves: 16, flows: 8, routes: 64 }],
]);

run("valve_mask overflow (uint16_t = 16 bits)", [
  ["16 valves", { tanks: 2, valves: 16, flows: 1, routes: 3 }],
  ["17 valves", { tanks: 2, valves: 17, flows: 1, routes: 3 }],
]);

// =============================================================================
// KC868-A16 — Segregated pin pools (expander outputs, native ADC, native pulse)
// =============================================================================

console.log("\n\n" + "\u2501".repeat(50));
console.log("KC868-A16 Scaling Tests");
console.log("\u2501".repeat(50));

const kcBoard: BoardDef = loadBoard(path.join(DEFAULTS, "boards/kc868-a16"));

// KC868 pin pools
const KC_OUT_PINS = Array.from({ length: 16 }, (_, i) => `OUT${i + 1}`);
const KC_PULSE_PINS = ["GPIO32", "GPIO33", "GPIO14"];

function kcPin(pool: string[], i: number): string {
  if (i < pool.length) return pool[i];
  return `VIRTUAL${i}`; // validator will catch
}

interface KcScaleParams {
  tanks: number;
  valves: number;
  flows: number;
  routes: number;
  pumps?: number; // defaults to 1
}

function buildKcManifest(p: KcScaleParams): Manifest {
  const numPumps = p.pumps ?? 1;
  let outIdx = 0;

  // Pumps use OUT pins
  const pumps = Array.from({ length: numPumps }, (_, i) => ({
    kind: 'pump' as const,
    id: `pump${i + 1}`,
    name: `Pump ${i + 1}`,
    pin: kcPin(KC_OUT_PINS, outIdx++),
  }));

  // Each valve uses 2 OUT pins
  const valves = Array.from({ length: p.valves }, (_, i) => ({
    kind: 'valve' as const,
    id: `valve${i + 1}`,
    name: `Valve ${i + 1}`,
    open_pin: kcPin(KC_OUT_PINS, outIdx++),
    close_pin: kcPin(KC_OUT_PINS, outIdx++),
  }));

  // Tanks (no level pins — level sensing is on level_sensor entities)
  const tanks = Array.from({ length: p.tanks }, (_, i) => ({
    kind: 'tank' as const,
    id: `tank${i + 1}`,
    name: `Tank ${i + 1}`,
  }));

  // Flow sensors use pulse counter pins
  const flowCount = Math.max(p.flows, 1);
  const flows = Array.from({ length: flowCount }, (_, i) => ({
    kind: 'flow_sensor' as const,
    id: `flow${i + 1}`,
    name: `Flow ${i + 1}`,
    pin: kcPin(KC_PULSE_PINS, i),
    flow_cal: 450,
  }));

  const nodes = [...pumps, ...tanks, ...valves, ...flows];

  const routes: Manifest["routes"] = [];
  for (let r = 0; r < p.routes && routes.length < p.routes; r++) {
    const srcIdx = r % p.tanks;
    const v1Idx = r % p.valves;
    const v2Idx = (r + 1) % p.valves;
    const isRefill = r % 3 === 0 && p.tanks > 1;
    const dstIdx = isRefill ? (srcIdx + 1) % p.tanks : undefined;
    if (dstIdx === srcIdx) continue;

    const routeValves = v1Idx === v2Idx
      ? [`valve${v1Idx + 1}`]
      : [`valve${v1Idx + 1}`, `valve${v2Idx + 1}`];

    routes.push({
      key: isRefill ? `tank${srcIdx + 1}>tank${dstIdx! + 1}` : `tank${srcIdx + 1}>endpoint`,
      name: isRefill ? `R${r}:T${srcIdx + 1}>T${dstIdx! + 1}` : `R${r}:T${srcIdx + 1}>E`,
      source: `tank${srcIdx + 1}`,
      source_type: "tank" as const,
      ...(isRefill ? { destination: `tank${dstIdx! + 1}` } : {}),
      valves: routeValves,
      flow_sensor: `flow${(r % flowCount) + 1}`,
      max_runtime_seconds: isRefill ? 600 : 1800,
      needs_pump: true,
      nodeSequence: [],
    } as Manifest["routes"][number]);
  }

  const defaultRoute: Manifest["routes"][number] = {
    key: "tank1>endpoint", name: "R0", source: "tank1", source_type: "tank" as const,
    valves: ["valve1"], flow_sensor: "flow1", max_runtime_seconds: 1800,
    needs_pump: true, nodeSequence: ["tank1", "valve1", "pump1", "flow1", "endpoint"],
  };

  return {
    device: { name: "kc-limit-test", friendly_name: "KC Limit Test", board: "kc868-a16" },
    nodes,
    routes: routes.length > 0 ? routes : [defaultRoute],
    timing: {
      valve_travel_time: 15,
      flow_watchdog: 30,
      flow_confirm: 15,
      flow_threshold: 0.5,
      api_watchdog: 300,
      update_interval: 5,
    },
    automations: [],
  };
}

function runKcTest(label: string, p: KcScaleParams): TestResult {
  const numPumps = p.pumps ?? 1;
  const flowCount = Math.max(p.flows, 1);
  const manifest = buildKcManifest(p);
  const result: TestResult = {
    label,
    pins: numPumps + p.tanks + p.valves * 2 + flowCount,
    routes: manifest.routes.length,
    parseOk: true,
    validateOk: false,
    generateOk: false,
    errors: [],
    warnings: [],
  };

  const v = runManifestRules(manifest, kcBoard, undefined, { loose: true });
  result.validateOk = v.ok;
  result.warnings = v.warnings;
  result.errors = v.errors;
  if (!v.ok) return result;

  try {
    const files = generateAll(manifest, kcBoard, 'test-site');
    result.generateOk = true;
    const rh = files.find((f) => f.relativePath.endsWith("routes.h"));
    if (rh) result.routesHLines = rh.content.split("\n").length;
  } catch (err) {
    result.errors.push(String(err));
  }

  return result;
}

function runKc(name: string, configs: Array<[string, KcScaleParams]>) {
  const results = configs.map(([label, p]) => runKcTest(label, p));
  suite(name, results);
  totalPass += results.filter((r) => r.generateOk).length;
  totalFail += results.filter((r) => !r.generateOk).length;
}

runKc("KC868 Valves (2 tanks, 1 flow, 1 pump)", [
  ["1 valve", { tanks: 2, valves: 1, flows: 1, routes: 2 }],
  ["4 valves", { tanks: 2, valves: 4, flows: 1, routes: 4 }],
  ["7 valves", { tanks: 2, valves: 7, flows: 1, routes: 4 }],
  ["8 valves (OUT overflow)", { tanks: 2, valves: 8, flows: 1, routes: 4 }],
]);

runKc("KC868 Valves no pump (2 tanks, 1 flow, VFD)", [
  ["7 valves", { tanks: 2, valves: 7, flows: 1, routes: 4, pumps: 0 }],
  ["8 valves", { tanks: 2, valves: 8, flows: 1, routes: 4, pumps: 0 }],
  ["9 valves (OUT overflow)", { tanks: 2, valves: 9, flows: 1, routes: 4, pumps: 0 }],
]);

runKc("KC868 Tanks (4 valves, 1 flow)", [
  ["1 tank", { tanks: 1, valves: 4, flows: 1, routes: 2 }],
  ["2 tanks", { tanks: 2, valves: 4, flows: 1, routes: 4 }],
  ["4 tanks", { tanks: 4, valves: 4, flows: 1, routes: 8 }],
  ["5 tanks (ADC overflow)", { tanks: 5, valves: 4, flows: 1, routes: 10 }],
]);

runKc("KC868 Flow sensors (2 tanks, 4 valves)", [
  ["1 flow", { tanks: 2, valves: 4, flows: 1, routes: 4 }],
  ["2 flows", { tanks: 2, valves: 4, flows: 2, routes: 4 }],
  ["3 flows", { tanks: 2, valves: 4, flows: 3, routes: 4 }],
  ["4 flows (pulse overflow)", { tanks: 2, valves: 4, flows: 4, routes: 4 }],
]);

runKc("KC868 Max config (4 tanks, 7 valves, 3 flows, 1 pump)", [
  ["N=2 (2T 4V 2F)", { tanks: 2, valves: 4, flows: 2, routes: 4 }],
  ["N=3 (3T 6V 3F)", { tanks: 3, valves: 6, flows: 3, routes: 9 }],
  ["N=4 max (4T 7V 3F)", { tanks: 4, valves: 7, flows: 3, routes: 12 }],
  ["Over max (5T 8V 4F)", { tanks: 5, valves: 8, flows: 4, routes: 16 }],
]);

// --- Summary ---

console.log(`\n${"\u2501".repeat(50)}`);
console.log("Hard limits (Heltec V3):");
console.log("  valve_mask      uint16_t       \u2192 max 16 valves/controller");
console.log("  ADC pins        ESP32-S3       \u2192 max ~10 native tank sensors");
console.log("  Pulse counter   native GPIO    \u2192 max ~6 flow sensors");
console.log("  GPIO budget     Heltec V3      \u2192 ~17 free (expandable via I2C)");
console.log("  Routes          flash memory   \u2192 practically unlimited");
console.log("  Flow sensors    1 per route    \u2192 every route requires a flow sensor");
console.log("");
console.log("Hard limits (KC868-A16):");
console.log("  Relay outputs   16x PCF8574    \u2192 max 7 valves + 1 pump (or 8 valves with VFD)");
console.log("  ADC inputs      4x native      \u2192 max 4 tanks with level sensors");
console.log("  Pulse counter   3x native      \u2192 max 3 flow sensors");
console.log("  valve_mask      uint16_t       \u2192 max 16 valves (but relay-limited to 7-8)");
console.log("  Routes          flash memory   \u2192 max 16 (conflict_mask limit)");

console.log(`\n${totalPass} passed, ${totalFail} expected failures`);
process.exit(0);
