/**
 * Integration tests: generate from the example manifest + board definition
 * and verify the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Manifest } from "../electron/lib/schema.js";
import { TopologySchema } from "../electron/lib/topology.js";
import { topologyToManifest } from "../electron/lib/topology-to-manifest.js";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";
import { validate } from "../electron/lib/validate.js";
import { generateAll, type GeneratedFile } from "../electron/lib/generate.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");
const BOARD_DIR = path.join(DEFAULTS, "boards/heltec-v3");

let manifest: Manifest;
let board: BoardDef;
let files: GeneratedFile[];
let fileMap: Map<string, string>;

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
  }
}

function getFile(suffix: string): string {
  for (const [key, content] of fileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No generated file ending with "${suffix}"`);
}

// --- Setup ---

console.log("Codegen Integration Tests");
console.log("=========================\n");

board = loadBoard(BOARD_DIR);
const rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
const topology = TopologySchema.parse(parseYaml(rawConfig));
manifest = topologyToManifest(topology);
const validation = validate(manifest, board);
files = generateAll(manifest, board);
fileMap = new Map(files.map((f) => [f.relativePath, f.content]));

// --- Board definition ---

console.log("Board definition:");
assert(board.model === "heltec_v3", `Board model = ${board.model}`);
assert(board.pins.length === 21, `${board.pins.length} exposed pins`);
assert(!!board.peripherals.oled, "Has OLED peripheral");
assert(!!board.peripherals.battery, "Has battery peripheral");
assert(!!board.peripherals.lora, "Has LoRa peripheral");

// --- Validation ---

console.log("\nManifest validation:");
assert(validation.ok, "Manifest passes validation");
assert(validation.errors.length === 0, "No validation errors");

// --- File generation ---

console.log("\nFile generation:");
const expectedSuffixes = [
  "board.yaml",
  "pump-controller.yaml",
  "routes.h",
  "hardware.yaml",
  "sensors.yaml",
  "pump.yaml",
];
for (const suffix of expectedSuffixes) {
  const found = [...fileMap.keys()].some((k) => k.endsWith(suffix));
  assert(found, `Generates ${suffix}`);
}

// --- Board package ---

console.log("\nboard.yaml (generated board package):");
const boardPkg = getFile("common/board.yaml");
assert(boardPkg.includes("esp32s3"), "MCU variant");
assert(boardPkg.includes("sda: GPIO17"), "I2C SDA");
assert(boardPkg.includes("scl: GPIO18"), "I2C SCL");
assert(boardPkg.includes("battery_voltage"), "Battery ADC sensor");
assert(boardPkg.includes("battery_percent"), "Battery percent sensor");
assert(boardPkg.includes("led_output"), "LED output");
assert(boardPkg.includes("vext"), "Vext control");
assert(boardPkg.includes("font_top_bar"), "OLED font (board has OLED)");
assert(boardPkg.includes("wifi_dbm"), "WiFi signal sensor");
assert(boardPkg.includes("uptime_sec"), "Uptime sensor");

// --- Device YAML ---

console.log("\ndevice YAML (generated):");
const deviceYaml = getFile("pump-controller.yaml");
assert(deviceYaml.includes("name: ${device_name}"), "ESPHome name sub");
assert(deviceYaml.includes("packages/routes.h"), "Includes routes.h");
assert(deviceYaml.includes("common/board.yaml"), "Includes board package");
assert(deviceYaml.includes("packages/control.yaml"), "Includes control");
assert(deviceYaml.includes("display:"), "OLED display block (board has OLED)");
assert(deviceYaml.includes("GPIO_NUM_21"), "OLED reset in boot (GPIO21)");
assert(deviceYaml.includes("NUM_ROUTES"), "Boot logs route count");
// Removed fields should NOT appear in substitutions
assert(!deviceYaml.includes("refill_watchdog_seconds"), "No refill_watchdog_seconds sub");
assert(!deviceYaml.includes("refill_min_rise_pct"), "No refill_min_rise_pct sub");
assert(!deviceYaml.includes("max_runtime_seconds"), "No global max_runtime_seconds sub");
assert(!deviceYaml.includes("refill_baseline"), "No refill_baseline in boot");
// Per-sensor flow_cal substitutions (not global)
for (const f of manifest.flow_sensors) {
  assert(deviceYaml.includes(`flow_cal_${f.id}: "${f.flow_cal}"`), `Per-sensor flow_cal sub for ${f.id}`);
}

// --- routes.h ---

console.log("\nroutes.h:");
const routesH = getFile("routes.h");
assert(routesH.includes(`NUM_ROUTES       = ${manifest.routes.length}`), `NUM_ROUTES = ${manifest.routes.length}`);
assert(routesH.includes(`NUM_VALVES       = ${manifest.valves.length}`), `NUM_VALVES = ${manifest.valves.length}`);
assert(routesH.includes(`NUM_FLOW_SENSORS = ${manifest.flow_sensors.length}`), `NUM_FLOW_SENSORS = ${manifest.flow_sensors.length}`);
for (const v of manifest.valves) {
  assert(routesH.includes(`id(${v.id}).make_call()`), `Valve ${v.id} in dispatch`);
}
for (const r of manifest.routes) {
  assert(routesH.includes(`"${r.name}"`), `Route "${r.name}" in table`);
}
// Architecture: no watchdog strategy dispatch
assert(!routesH.includes("WD_LEVEL_RISE"), "No WD_LEVEL_RISE define");
assert(!routesH.includes("WD_RUNTIME"), "No WD_RUNTIME define");
assert(!routesH.includes("WD_FLOW"), "No WD_FLOW define (removed — flow is unconditional)");
assert(!routesH.includes("uint8_t     watchdog"), "No watchdog field in struct");
assert(routesH.includes("max_runtime_s"), "Has max_runtime_s field in struct");
// Every route has a valid flow sensor index (never 0xFF)
assert(!routesH.includes("0xFF, ") || !routesH.match(/\d+, 0xFF,.*0xFF,/), "No 0xFF flow sensor in any route");

// --- hardware.yaml ---

console.log("\nhardware.yaml:");
const hw = getFile("hardware.yaml");
assert(hw.includes("pump_relay"), "Has pump relay");
assert(hw.includes("system_state") && hw.includes("!= 2"), "Relay guard");
for (const v of manifest.valves) {
  assert(hw.includes(`id: ${v.id}_open_pin`), `Valve ${v.id} open pin`);
  assert(hw.includes(`interlock:`), `Has interlock`);
}

// --- sensors.yaml ---

console.log("\nsensors.yaml:");
const sensors = getFile("sensors.yaml");
for (const f of manifest.flow_sensors) {
  assert(sensors.includes(`id: ${f.id}`), `Flow ${f.id} defined`);
  assert(sensors.includes(`\${flow_cal_${f.id}}`), `Flow ${f.id} uses per-sensor cal`);
}
for (const t of manifest.tanks) {
  assert(sensors.includes(`id: ${t.id}_level`), `Tank ${t.id} level`);
  assert(sensors.includes(`id: ${t.id}_cal_empty`), `Tank ${t.id} cal`);
}
// Tank suppression: checks source AND dest, states 1-3
assert(sensors.includes("r.source_tank == TANK_IDX || r.dest_tank == TANK_IDX"), "Suppresses source AND dest tanks");
assert(sensors.includes("s >= 1 && s <= 3"), "Suppresses during states 1, 2, 3");
// Fault/stop text: no old codes
assert(!sensors.includes("No level rise"), "No 'level rise' in fault/stop text");
assert(!sensors.includes("Source tank empty"), "No 'source empty' in fault/stop text");
assert(sensors.includes("No flow detected"), "Has 'No flow detected' fault");
assert(sensors.includes("Max runtime exceeded"), "Has 'Max runtime exceeded' fault");
assert(sensors.includes("HA connection lost"), "Has 'HA connection lost' fault");

// --- Cross-file consistency ---

console.log("\nCross-file consistency:");
for (const t of manifest.tanks) {
  assert(
    sensors.includes(`id: ${t.id}_level`) && routesH.includes(`id(${t.id}_level)`),
    `Tank ${t.id}: sensors \u2194 routes.h`
  );
}
for (const f of manifest.flow_sensors) {
  assert(
    sensors.includes(`id: ${f.id}`) && routesH.includes(`id(${f.id})`),
    `Flow ${f.id}: sensors \u2194 routes.h`
  );
}
for (const v of manifest.valves) {
  assert(
    hw.includes(`id: ${v.id}\n`) && routesH.includes(`id(${v.id}).make_call()`),
    `Valve ${v.id}: hardware \u2194 routes.h`
  );
}

// --- Route table correctness ---

console.log("\nRoute table logic:");
const valveIdx = new Map(manifest.valves.map((v, i) => [v.id, i]));
for (const route of manifest.routes) {
  const mask = route.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
  const maskBin = `0b${mask.toString(2).padStart(manifest.valves.length, "0")}`;
  assert(routesH.includes(maskBin), `Route "${route.name}" valve_mask = ${maskBin}`);
}

// Every route has per-route max_runtime in the table
for (const route of manifest.routes) {
  assert(
    routesH.includes(`${route.max_runtime_seconds}, "${route.name}"`),
    `Route "${route.name}" max_runtime_s = ${route.max_runtime_seconds}`
  );
}

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
