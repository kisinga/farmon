/**
 * Integration tests: generate from the example manifest + board definition
 * and verify the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { ManifestSchema, type Manifest } from "../electron/lib/schema.js";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";
import { validate } from "../electron/lib/validate.js";
import { generateAll, type GeneratedFile } from "../electron/lib/generate.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const MANIFEST_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");
const BOARD_DIR = path.join(DEFAULTS, "boards/heltec-v3");

let manifest: Manifest;
let board: BoardDef;
let files: GeneratedFile[];
let fileMap: Map<string, string>;

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
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
const rawManifest = fs.readFileSync(MANIFEST_PATH, "utf-8");
manifest = ManifestSchema.parse(parseYaml(rawManifest));
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

// --- routes.h ---

console.log("\nroutes.h:");
const routesH = getFile("routes.h");
assert(routesH.includes(`NUM_ROUTES       = ${manifest.routes.length}`), `NUM_ROUTES = ${manifest.routes.length}`);
assert(routesH.includes(`NUM_VALVES       = ${manifest.valves.length}`), `NUM_VALVES = ${manifest.valves.length}`);
for (const v of manifest.valves) {
  assert(routesH.includes(`id(${v.id}).make_call()`), `Valve ${v.id} in dispatch`);
}
for (const r of manifest.routes) {
  assert(routesH.includes(`"${r.name}"`), `Route "${r.name}" in table`);
}

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
}
for (const t of manifest.tanks) {
  assert(sensors.includes(`id: ${t.id}_level`), `Tank ${t.id} level`);
  assert(sensors.includes(`id: ${t.id}_cal_empty`), `Tank ${t.id} cal`);
}
assert(sensors.includes("ROUTES[id(active_route)]"), "Route table reference");

// --- Cross-file consistency ---

console.log("\nCross-file consistency:");
for (const t of manifest.tanks) {
  assert(
    sensors.includes(`id: ${t.id}_level`) && routesH.includes(`id(${t.id}_level)`),
    `Tank ${t.id}: sensors ↔ routes.h`
  );
}
for (const f of manifest.flow_sensors) {
  assert(
    sensors.includes(`id: ${f.id}`) && routesH.includes(`id(${f.id})`),
    `Flow ${f.id}: sensors ↔ routes.h`
  );
}
for (const v of manifest.valves) {
  assert(
    hw.includes(`id: ${v.id}\n`) && routesH.includes(`id(${v.id}).make_call()`),
    `Valve ${v.id}: hardware ↔ routes.h`
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

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
