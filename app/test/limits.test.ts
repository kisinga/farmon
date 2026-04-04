/**
 * Scaling limits tests: vary manifest parameters to find hard ceilings
 * in the codegen, validator, and generated firmware.
 *
 * Usage: npm run test:limits
 */

import * as path from "node:path";
import { ManifestSchema } from "../electron/lib/schema.js";
import { validate } from "../electron/lib/validate.js";
import { generateAll } from "../electron/lib/generate.js";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const board: BoardDef = loadBoard(path.join(DEFAULTS, "boards/heltec-v3"));

// --- GPIO pin pool (free pins on Heltec V3) ---
const FREE_PINS = [
  2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 19, 20, 22, 23, 24, 25,
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

function buildManifest(p: ScaleParams): unknown {
  let pinIdx = 0;
  const pumpPin = pin(pinIdx++);

  // Ensure at least 1 flow sensor (schema requires it)
  const flowCount = Math.max(p.flows, 1);

  const tanks = Array.from({ length: p.tanks }, (_, i) => ({
    name: `Tank ${i + 1}`,
    id: `tank${i + 1}`,
    level_pin: pin(pinIdx++),
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
      ...(isRefill ? { destination: `tank${dstIdx! + 1}` } : {}),
      valves: routeValves,
      flow_sensor: `flow${(r % flowCount) + 1}`,
      max_runtime_seconds: isRefill ? 600 : 1800,
    });
  }

  return {
    device: { name: "limit-test", friendly_name: "Limit Test", board: "heltec-v3" },
    pump: { pin: pumpPin },
    tanks,
    valves,
    flow_sensors: flows,
    routes: routes.length > 0
      ? routes
      : [{ name: "R0", source: "tank1", valves: ["valve1"], flow_sensor: "flow1", max_runtime_seconds: 1800 }],
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
  const raw = buildManifest(p);
  const result: TestResult = {
    label,
    pins: 1 + p.tanks + p.valves * 2 + flowCount,
    routes: 0,
    parseOk: false,
    validateOk: false,
    generateOk: false,
    errors: [],
    warnings: [],
  };

  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    result.errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return result;
  }
  result.parseOk = true;
  result.routes = parsed.data.routes.length;

  const v = validate(parsed.data, board, { loose: true });
  result.validateOk = v.ok;
  result.warnings = v.warnings;
  result.errors = v.errors;
  if (!v.ok) return result;

  try {
    const files = generateAll(parsed.data, board);
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

// --- Summary ---

console.log(`\n${"\u2501".repeat(50)}`);
console.log("Hard limits:");
console.log("  valve_mask      uint16_t       \u2192 max 16 valves/controller");
console.log("  ADC pins        ESP32-S3       \u2192 max ~10 native tank sensors");
console.log("  Pulse counter   native GPIO    \u2192 max ~6 flow sensors");
console.log("  GPIO budget     Heltec V3      \u2192 ~17 free (expandable via I2C)");
console.log("  Routes          flash memory   \u2192 practically unlimited");
console.log("  Flow sensors    1 per route    \u2192 every route requires a flow sensor");

console.log(`\n${totalPass} passed, ${totalFail} expected failures`);
process.exit(0);
