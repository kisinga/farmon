/**
 * Integration tests: generate from the example manifest + board definition
 * and verify the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type Manifest, type ManifestNode, nodesByKind, parseTopology, topologyToManifest } from "@far-mon/core";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";
import { validateAll } from "../electron/lib/validate.js";
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

/** Shorthand for ManifestNode string field access. */
function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

// --- Setup ---

console.log("Codegen Integration Tests");
console.log("=========================\n");

board = loadBoard(BOARD_DIR);
const rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
const topology = parseTopology(parseYaml(rawConfig));
manifest = topologyToManifest(topology);
const validation = validateAll(topology, manifest, board);
files = generateAll(manifest, board);
fileMap = new Map(files.map((f) => [f.relativePath, f.content]));

// Helper arrays
const valves = nodesByKind(manifest.nodes, 'valve');
const flowSensors = nodesByKind(manifest.nodes, 'flow_sensor');
const tanks = nodesByKind(manifest.nodes, 'tank');
const waterSources = nodesByKind(manifest.nodes, 'water_source');

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
  "control.yaml",
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
for (const f of flowSensors) {
  assert(deviceYaml.includes(`flow_cal_${n(f, 'id')}: "${n(f, 'flow_cal')}"`), `Per-sensor flow_cal sub for ${n(f, 'id')}`);
}

// --- routes.h ---

console.log("\nroutes.h:");
const routesH = getFile("routes.h");
assert(routesH.includes(`NUM_ROUTES        = ${manifest.routes.length}`), `NUM_ROUTES = ${manifest.routes.length}`);
assert(routesH.includes(`NUM_VALVES        = ${valves.length}`), `NUM_VALVES = ${valves.length}`);
assert(routesH.includes(`NUM_FLOW_SENSORS  = ${flowSensors.length}`), `NUM_FLOW_SENSORS = ${flowSensors.length}`);
assert(routesH.includes(`NUM_WATER_SOURCES = ${waterSources.length}`), `NUM_WATER_SOURCES = ${waterSources.length}`);
for (const v of valves) {
  assert(routesH.includes(`id(${n(v, 'id')}).make_call()`), `Valve ${n(v, 'id')} in dispatch`);
}
for (const r of manifest.routes) {
  assert(routesH.includes(`"${r.name}"`), `Route "${r.name}" in route table`);
}
// Architecture: no watchdog strategy dispatch
assert(!routesH.includes("WD_LEVEL_RISE"), "No WD_LEVEL_RISE define");
assert(!routesH.includes("WD_RUNTIME"), "No WD_RUNTIME define");
assert(!routesH.includes("WD_FLOW"), "No WD_FLOW define (removed — flow is unconditional)");
assert(!routesH.includes("uint8_t     watchdog"), "No watchdog field in struct");
assert(routesH.includes("max_runtime_s"), "Has max_runtime_s field in struct");
// Route struct has source_ws field for water source support
assert(routesH.includes("source_ws"), "Has source_ws field in struct");
// Concurrent execution support
assert(routesH.includes("struct RouteSlot"), "Has RouteSlot struct");
assert(routesH.includes("MAX_CONCURRENT_ROUTES"), "Has MAX_CONCURRENT_ROUTES constant");
assert(routesH.includes("needs_pump"), "Has needs_pump field in Route struct");
assert(routesH.includes("queue_push"), "Has queue_push function");
assert(routesH.includes("queue_pop"), "Has queue_pop function");
assert(routesH.includes("pump_ref_count"), "Has pump_ref_count function");
assert(routesH.includes("has_conflict"), "Has conflict detection");
assert(routesH.includes("conflict_mask"), "Has conflict mask in Route struct");
assert(routesH.includes("safe_close_mask"), "Has valve refcount for safe close");
assert(routesH.includes("derived_system_state"), "Has derived_system_state function");
assert(routesH.includes("open_valve_hw"), "Valve dispatch renamed to _hw");
assert(routesH.includes("close_valve_hw"), "Valve close dispatch renamed to _hw");
assert(routesH.includes("get_valve_travel_ms"), "Has per-valve travel time dispatch");
assert(routesH.includes("get_route_travel_ms"), "Has per-route travel time dispatch");
assert(routesH.includes("get_max_runtime_s"), "Has per-route max runtime dispatch");

// --- hardware.yaml ---

console.log("\nhardware.yaml:");
const hw = getFile("hardware.yaml");
assert(hw.includes("pump_relay"), "Has pump relay");
assert(hw.includes("pump_ref_count()"), "Relay guard uses pump refcount");
for (const v of valves) {
  assert(hw.includes(`id: ${n(v, 'id')}_open_pin`), `Valve ${n(v, 'id')} open pin`);
  assert(hw.includes(`interlock:`), `Has interlock`);
}

// --- sensors.yaml ---

console.log("\nsensors.yaml:");
const sensors = getFile("sensors.yaml");
for (const f of flowSensors) {
  assert(sensors.includes(`id: ${n(f, 'id')}`), `Flow ${n(f, 'id')} defined`);
  assert(sensors.includes(`\${flow_cal_${n(f, 'id')}}`), `Flow ${n(f, 'id')} uses per-sensor cal`);
}
for (const t of tanks) {
  if (t['level_pin']) {
    assert(sensors.includes(`id: ${n(t, 'id')}_level`), `Tank ${n(t, 'id')} level`);
    assert(sensors.includes(`id: ${n(t, 'id')}_cal_empty`), `Tank ${n(t, 'id')} cal`);
  }
}
// Tank suppression: iterates slots, checks source AND dest
assert(sensors.includes("r.source_tank == TANK_IDX || r.dest_tank == TANK_IDX"), "Suppresses source AND dest tanks");
assert(sensors.includes("MAX_CONCURRENT_ROUTES"), "Tank suppression iterates slots");
// Fault/stop text: no old codes
assert(!sensors.includes("No level rise"), "No 'level rise' in fault/stop text");
assert(!sensors.includes("Source tank empty"), "No 'source empty' in fault/stop text");
assert(sensors.includes("No flow detected"), "Has 'No flow detected' fault");
assert(sensors.includes("Max runtime exceeded"), "Has 'Max runtime exceeded' fault");
assert(sensors.includes("HA connection lost"), "Has 'HA connection lost' fault");
// New concurrent execution sensors
assert(sensors.includes("active_routes_text"), "Has active_routes_text sensor");
assert(sensors.includes("route_queue_text"), "Has route_queue_text sensor");
assert(sensors.includes("queue_count"), "Queue text references queue_count");

// --- control.yaml ---

console.log("\ncontrol.yaml:");
const control = getFile("control.yaml");
assert(control.includes("service: route_start"), "Has route_start service");
assert(control.includes("service: route_stop"), "Has route_stop service");
assert(control.includes("service: stop_all"), "Has stop_all service");
assert(control.includes("service: fault_reset_all"), "Has fault_reset_all service");
assert(control.includes("service: queue_clear"), "Has queue_clear service");
assert(control.includes("interval: 1s"), "Has 1s transition interval");
assert(control.includes("interval: 2s"), "Has 2s safety interval");
assert(control.includes("find_slot_by_route"), "Uses slot-based route lookup");
assert(control.includes("has_conflict"), "Checks conflicts before starting");
assert(control.includes("safe_close_mask"), "Uses valve refcount on stop");
assert(control.includes("try_route_start"), "Delegates to try_route_start (which queues on conflict)");
assert(!control.includes("close_all_valves"), "No close_all_valves script");
assert(!control.includes("do_prepare_and_run"), "No do_prepare_and_run script");
assert(!control.includes("id(active_route)"), "No active_route global reference");

// --- Cross-file consistency ---

console.log("\nCross-file consistency:");
for (const t of tanks) {
  if (t['level_pin']) {
    assert(
      sensors.includes(`id: ${n(t, 'id')}_level`) && routesH.includes(`id(${n(t, 'id')}_level)`),
      `Tank ${n(t, 'id')}: sensors \u2194 routes.h`
    );
  }
}
for (const f of flowSensors) {
  assert(
    sensors.includes(`id: ${n(f, 'id')}`) && routesH.includes(`id(${n(f, 'id')})`),
    `Flow ${n(f, 'id')}: sensors \u2194 routes.h`
  );
}
for (const v of valves) {
  assert(
    hw.includes(`id: ${n(v, 'id')}\n`) && routesH.includes(`id(${n(v, 'id')}).make_call()`),
    `Valve ${n(v, 'id')}: hardware \u2194 routes.h`
  );
}

// --- Route table correctness ---

console.log("\nRoute table logic:");
const valveIdx = new Map(valves.map((v, i) => [n(v, 'id'), i]));
for (const route of manifest.routes) {
  const mask = route.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
  const maskBin = `0b${mask.toString(2).padStart(valves.length, "0")}`;
  assert(routesH.includes(maskBin), `Route "${route.name}" valve_mask = ${maskBin}`);
}

// Every route has per-route max_runtime and name in the table
for (const route of manifest.routes) {
  assert(
    routesH.includes(`"${route.name}"`),
    `Route "${route.name}" name in table`
  );
  assert(
    routesH.includes(`${route.max_runtime_seconds}`),
    `Route "${route.name}" max_runtime_s = ${route.max_runtime_seconds}`
  );
}

// =============================================================================
// VFD Entity Tests — Modbus VFD pump replacing GPIO relay
// =============================================================================

console.log("\n\nVFD Entity Tests");
console.log("================\n");

const VFD_CONFIG_PATH = path.join(DEFAULTS, "configs/vfd-pump-controller.yaml");
const vfdRawConfig = fs.readFileSync(VFD_CONFIG_PATH, "utf-8");
const vfdTopology = parseTopology(parseYaml(vfdRawConfig));
const vfdManifest = topologyToManifest(vfdTopology);
const vfdFiles = generateAll(vfdManifest, board);
const vfdFileMap = new Map(vfdFiles.map((f) => [f.relativePath, f.content]));

function getVfdFile(suffix: string): string {
  for (const [key, content] of vfdFileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No VFD generated file ending with "${suffix}"`);
}

// --- Topology & routes ---

console.log("Topology:");
assert(vfdTopology.device.uart_buses.length === 1, "Has 1 UART bus");
assert(vfdTopology.device.uart_buses[0].id === "uart_modbus", "UART bus id = uart_modbus");

const vfdRoutes = vfdManifest.routes;
assert(vfdRoutes.length === 1, `${vfdRoutes.length} route (tank1>tank2)`);
assert(vfdRoutes[0].needs_pump, "Route needs_pump = true (VFD has isPump flag)");

// --- Device YAML ---

console.log("\nDevice YAML:");
const vfdDeviceYaml = getVfdFile("vfd-pump-controller.yaml");
assert(vfdDeviceYaml.includes("uart:"), "Has uart: section");
assert(vfdDeviceYaml.includes("id: uart_modbus"), "UART bus id in output");
assert(vfdDeviceYaml.includes("tx_pin: GPIO17"), "UART TX pin");
assert(vfdDeviceYaml.includes("rx_pin: GPIO18"), "UART RX pin");
assert(vfdDeviceYaml.includes("de_pin: GPIO19"), "UART DE pin");
assert(vfdDeviceYaml.includes("baud_rate: 9600"), "UART baud rate");
assert(vfdDeviceYaml.includes("modbus:"), "Has modbus: section");
assert(vfdDeviceYaml.includes("id: uart_modbus_modbus"), "Modbus controller id");
assert(vfdDeviceYaml.includes("switch.turn_off"), "Boot turns off pump_relay");

// --- Hardware ---

console.log("\nHardware:");
const vfdHw = getVfdFile("hardware.yaml");
assert(vfdHw.includes("pump_relay"), "Has pump_relay (from VFD codegen)");
assert(vfdHw.includes("modbus_controller"), "Uses modbus_controller platform");
assert(vfdHw.includes("uart_modbus_modbus"), "References modbus controller id");

// --- Sensors ---

console.log("\nSensors:");
const vfdSensors = getVfdFile("sensors.yaml");
assert(vfdSensors.includes("vfd1_power"), "Has VFD power sensor");
assert(vfdSensors.includes("vfd1_frequency"), "Has VFD frequency sensor");

// --- Routes.h ---

console.log("\nRoutes.h:");
const vfdRoutesH = getVfdFile("routes.h");
assert(vfdRoutesH.includes("pump_ref_count"), "Has pump_ref_count (VFD is isPump)");
// pump_relay is referenced in control.yaml, not routes.h — check control instead
const vfdControl = getVfdFile("control.yaml");
assert(vfdControl.includes("pump_relay"), "Control references pump_relay");

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
