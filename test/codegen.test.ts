/**
 * Integration tests: generate from the example manifest + board definition
 * and verify the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type Manifest, type ManifestNode, nodesByKind, parseTopology, topologyToManifest, reservedPins } from "@far-mon/core";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";
import { validateAll } from "../electron/lib/validate.js";
import { generateAll, type GeneratedFile } from "../electron/lib/generate.js";
import { generateBoardPackage } from "../electron/lib/generators/board-package.js";

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
files = generateAll(manifest, board, 'test-site');
fileMap = new Map(files.map((f) => [f.relativePath, f.content]));

// Helper arrays
const valves = nodesByKind(manifest.nodes, 'valve');
const flowSensors = nodesByKind(manifest.nodes, 'flow_sensor');
const levelSensors = nodesByKind(manifest.nodes, 'level_sensor');
const waterSources = nodesByKind(manifest.nodes, 'water_source');

// --- Board definition ---

console.log("Board definition:");
assert(board.model === "heltec_v3", `Board model = ${board.model}`);
assert(board.pins.length === 20, `${board.pins.length} exposed pins`);
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
for (const ls of levelSensors) {
  assert(sensors.includes(`id: ${n(ls, 'id')}_level`), `Level sensor ${n(ls, 'id')} level`);
  assert(sensors.includes(`id: ${n(ls, 'id')}_cal_empty`), `Level sensor ${n(ls, 'id')} cal`);
}
// Level sensor suppression: iterates slots, checks source AND dest
assert(sensors.includes("r.source_tank == LEVEL_SENSOR_IDX || r.dest_tank == LEVEL_SENSOR_IDX"), "Suppresses source AND dest level sensors");
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
for (const ls of levelSensors) {
  assert(
    sensors.includes(`id: ${n(ls, 'id')}_level`) && routesH.includes(`id(${n(ls, 'id')}_level)`),
    `Level sensor ${n(ls, 'id')}: sensors \u2194 routes.h`
  );
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
const vfdFiles = generateAll(vfdManifest, board, 'test-site');
const vfdFileMap = new Map(vfdFiles.map((f) => [f.relativePath, f.content]));

function getVfdFile(suffix: string): string {
  for (const [key, content] of vfdFileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No VFD generated file ending with "${suffix}"`);
}

// --- Topology & routes ---

console.log("Topology:");
assert(vfdTopology.device.uart_buses?.length === 1, "Has 1 UART bus");
assert(vfdTopology.device.uart_buses?.[0].id === "uart_modbus", "UART bus id = uart_modbus");

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
assert(vfdSensors.includes("vfd1_speed_setpoint"), "Has VFD speed setpoint number");
assert(vfdSensors.includes("max_value: 50"), "Speed setpoint max = max_frequency");
assert(vfdSensors.includes("number:"), "Has number: section for speed setpoint");
assert(vfdSensors.includes("button:"), "Has button: section for fault reset");
assert(vfdSensors.includes("vfd1_fault_reset"), "Has VFD fault reset button");

// --- Routes.h ---

console.log("\nRoutes.h:");
const vfdRoutesH = getVfdFile("routes.h");
assert(vfdRoutesH.includes("pump_ref_count"), "Has pump_ref_count (VFD is isPump)");
// pump_relay is referenced in control.yaml, not routes.h — check control instead
const vfdControl = getVfdFile("control.yaml");
assert(vfdControl.includes("pump_relay"), "Control references pump_relay");

// =============================================================================
// KC868-A16 Board Tests — PCF8574 expander pins + Ethernet
// =============================================================================

console.log("\n\nKC868-A16 Board Tests");
console.log("====================\n");

const KC_BOARD_DIR = path.join(DEFAULTS, "boards/kc868-a16");
const KC_CONFIG_PATH = path.join(DEFAULTS, "configs/kc868-a16-controller.yaml");
const kcBoard = loadBoard(KC_BOARD_DIR);
const kcRawConfig = fs.readFileSync(KC_CONFIG_PATH, "utf-8");
const kcTopology = parseTopology(parseYaml(kcRawConfig));
const kcManifest = topologyToManifest(kcTopology);
const kcFiles = generateAll(kcManifest, kcBoard, 'test-site');
const kcFileMap = new Map(kcFiles.map((f) => [f.relativePath, f.content]));

function getKcFile(suffix: string): string {
  for (const [key, content] of kcFileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No KC868 generated file ending with "${suffix}"`);
}

// --- Board definition ---

console.log("Board definition:");
assert(kcBoard.model === "kc868_a16", `Board model = ${kcBoard.model}`);
assert(kcBoard.pins.length === 39, `${kcBoard.pins.length} pins (32 expander + 7 native)`);
assert(kcBoard.expanders?.length === 4, "Has 4 PCF8574 expanders");
assert(!!kcBoard.peripherals.ethernet, "Has Ethernet peripheral");
assert(!kcBoard.peripherals.oled, "No OLED");
assert(!kcBoard.peripherals.battery, "No battery");

// --- Board package ---

console.log("\nBoard package:");
const kcBoardPkg = getKcFile("common/board.yaml");
assert(kcBoardPkg.includes("esp32"), "MCU variant");
assert(kcBoardPkg.includes("esp-idf"), "Framework = esp-idf");
assert(kcBoardPkg.includes("sda: GPIO4"), "I2C SDA");
assert(kcBoardPkg.includes("ignore_strapping_warning: true"), "SCL GPIO5 strapping warning suppressed");
assert(kcBoardPkg.includes("ethernet:"), "Has ethernet: section");
assert(kcBoardPkg.includes("LAN8720"), "Ethernet type = LAN8720");
assert(kcBoardPkg.includes("mdc_pin: GPIO23"), "Ethernet MDC pin");
assert(kcBoardPkg.includes("pin: GPIO17"), "Ethernet CLK pin (structured)");
assert(kcBoardPkg.includes("mode: CLK_OUT"), "Ethernet CLK mode (structured)");
assert(!kcBoardPkg.includes("clk_mode"), "No deprecated clk_mode key");
assert(!kcBoardPkg.includes("wifi:"), "No wifi: section (ethernet board, default transport)");
assert(!kcBoardPkg.includes("captive_portal"), "No captive_portal (no wifi)");
assert(kcBoardPkg.includes("web_server:"), "Has web_server: dashboard for in-browser control");
// web_server MUST stay on port 80: ESPHome's web_server_base is a singleton
// AsyncWebServer shared with captive_portal. Moving it to another port
// removes any HTTP listener from 192.168.4.1:80 → fallback AP captive
// portal silently breaks. (See networking.ts emitWebServer comment.)
assert(kcBoardPkg.includes("port: 80"), "web_server pinned to port 80 — required for fallback AP captive portal");
assert(kcBoardPkg.includes("pcf8574:"), "Has pcf8574: expander declarations");
assert(kcBoardPkg.includes("pcf8575: false"), "Explicit pcf8575: false on expanders");
assert(kcBoardPkg.includes("0x24"), "PCF8574 output expander 1 address");
assert(kcBoardPkg.includes("0x25"), "PCF8574 output expander 2 address");
assert(kcBoardPkg.includes("uptime_sec"), "Has uptime sensor");
assert(!kcBoardPkg.includes("wifi_dbm"), "No WiFi signal sensor (ethernet board)");
assert(kcBoardPkg.includes("ethernet_info"), "Has ethernet_info text sensor for IP address");
assert(kcBoardPkg.includes("ip_addr"), "Has IP address entity");
assert(!kcBoardPkg.includes("\nuart:"), "No uart: section in board package (user-configured per topology)");

// --- Transport selector ---
const kcBoardPkgWifi = generateBoardPackage(kcBoard, { mode: 'dhcp', transport: 'wifi' });
assert(!kcBoardPkgWifi.includes("ethernet:"), "transport=wifi: no ethernet: section");
assert(kcBoardPkgWifi.includes("wifi:"), "transport=wifi: has wifi: section");
// captive_portal IS emitted: it's the only ESPHome component that binds
// the SoftAP interface for HTTP. Without it, 192.168.4.1 has no page
// (esphome/issues#4333). The dashboard never serves on the AP, so AP +
// captive_portal exist solely as a credential-recovery hatch alongside
// Improv (which is the preferred modern path).
assert(kcBoardPkgWifi.includes("captive_portal"), "transport=wifi: has captive_portal (only AP-mode HTTP surface)");
assert(kcBoardPkgWifi.includes("esp32_improv"), "transport=wifi: has esp32_improv (BLE recovery)");
assert(kcBoardPkgWifi.includes("improv_serial"), "transport=wifi: has improv_serial (USB recovery)");
assert(kcBoardPkgWifi.includes("ap:"), "transport=wifi: has ap: fallback hotspot");
assert(kcBoardPkgWifi.includes("web_server:"), "transport=wifi: has web_server");
// SoftAP password reuses the wifi station password — single credential UX.
// Reachable at 192.168.4.1 when the station fails to associate.
assert(!kcBoardPkgWifi.includes("fallback_password"), "transport=wifi: no fallback_password (reuses wifi_password)");
const apMatches = kcBoardPkgWifi.match(/!secret wifi_password/g) ?? [];
assert(apMatches.length === 2, `transport=wifi: !secret wifi_password used twice (sta + ap), got ${apMatches.length}`);
// Diagnostic sensors must follow the active transport, not board capability:
assert(!kcBoardPkgWifi.includes("ethernet_info"), "transport=wifi on ethernet board: no ethernet_info text_sensor");
assert(kcBoardPkgWifi.includes("wifi_info"), "transport=wifi: has wifi_info text_sensor");
assert(kcBoardPkgWifi.includes("wifi_dbm"), "transport=wifi: has wifi_signal sensor");

const kcBoardPkgEth = generateBoardPackage(kcBoard, { mode: 'dhcp', transport: 'ethernet' });
assert(kcBoardPkgEth.includes("ethernet:"), "transport=ethernet: ethernet present");
assert(!kcBoardPkgEth.includes("wifi:"), "transport=ethernet: no wifi");
assert(kcBoardPkgEth.includes("ethernet_info"), "transport=ethernet: has ethernet_info text_sensor");
assert(!kcBoardPkgEth.includes("wifi_dbm"), "transport=ethernet: no wifi_signal sensor");

// Self-describing introspection sensors so HA/web_server can show the device's
// network model without inferring from the YAML.
assert(kcBoardPkg.includes("transport_supported"), "Has transport_supported template text_sensor");
assert(kcBoardPkg.includes("transport_active"), "Has transport_active template text_sensor");
assert(kcBoardPkg.includes('std::string("ethernet,wifi")'), "transport_supported reports both capabilities for ethernet board");
assert(kcBoardPkg.includes('std::string("ethernet")'), "transport_active reports the active transport (ethernet by default)");
assert(kcBoardPkgWifi.includes('std::string("wifi")'), "transport_active reports wifi when forced");
// Single text_sensor: block per device — guards against the YAML key collision regression.
const ethTextSensorBlocks = (kcBoardPkg.match(/^text_sensor:/gm) ?? []).length;
assert(ethTextSensorBlocks === 1, `Single text_sensor: top-level block (got ${ethTextSensorBlocks})`);

// RS485 bus pin reservation
console.log("\nRS485 pin reservation:");
const kcReserved = reservedPins(kcBoard);
assert(kcReserved.has("GPIO13"), `GPIO13 reserved for ${kcReserved.get("GPIO13")}`);
assert(kcReserved.has("GPIO16"), `GPIO16 reserved for ${kcReserved.get("GPIO16")}`);

// --- Hardware (expander pin resolution) ---

console.log("\nHardware:");
const kcHw = getKcFile("hardware.yaml");
assert(kcHw.includes("pump_relay"), "Has pump relay");
assert(kcHw.includes("pcf8574: pcf8574_out_1"), "Pump pin resolved to PCF8574 expander");
assert(kcHw.includes("valve1_open_pin"), "Valve open pin declared");
assert(kcHw.includes("valve1_close_pin"), "Valve close pin declared");

// --- Sensors ---

console.log("\nSensors:");
const kcSensors = getKcFile("sensors.yaml");
assert(kcSensors.includes("id: flow1"), "Flow sensor defined");
assert(kcSensors.includes("GPIO32"), "Flow sensor uses native GPIO32");
assert(kcSensors.includes("id: ls1_level"), "Level sensor defined");
assert(kcSensors.includes("GPIO36"), "Level sensor uses native GPIO36 for ADC");

// --- Device YAML ---

console.log("\nDevice YAML:");
const kcDeviceYaml = getKcFile("kc868-controller.yaml");
assert(kcDeviceYaml.includes("name: ${device_name}"), "ESPHome name sub");
assert(!kcDeviceYaml.includes("display:"), "No OLED display (board has no OLED)");

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
