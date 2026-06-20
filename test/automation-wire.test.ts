/**
 * Drift guard: the packed automation wire layout (automation-wire.ts reference
 * encoder) MUST match the firmware C++ struct (automation-engine.h) and the baked
 * route_set_version. A positional binary encoding rots silently, so this pins the
 * header/record sizes, field offsets via a golden vector, and the struct's
 * static_assert + field order. The Go server encoder (Step 3) mirrors the same
 * bytes and is checked against this golden vector on its side.
 *
 * Usage: npx tsx test/automation-wire.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology, topologyToManifestForController, routeSetVersion,
  serializeAutomationSet, AUTOMATION_HEADER_BYTES, AUTOMATION_RECORD_BYTES,
  AUTOMATION_ID_BYTES, AUTOMATION_WIRE_MAGIC, MAX_AUTOMATIONS, type Manifest, type WireAutomation,
} from "@core";
import { generateAll, createTestMetadata } from "@core/codegen";
import { loadBoard } from "./helpers";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");
const BOARD_DIR = path.join(DEFAULTS, "boards/heltec-v3");

let passed = 0, failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("Automation wire drift guard");
console.log("===========================\n");

// --- Sizes ---
assert(AUTOMATION_HEADER_BYTES === 6, "header is 6 bytes");
assert(AUTOMATION_RECORD_BYTES === 20, "record is 20 bytes");

// --- Golden vector: one fully-populated automation, exact bytes per offset ---
const AUTO_ID = "abc123def456ghi"; // 15-char PocketBase id
const a: WireAutomation = {
  id: AUTO_ID,
  enabled: true, trigger_type: 0, days_mask: 0b0101010 /* Mon,Wed,Fri = bits 0,2,4 */,
  level_threshold_pct: 80, route_index: 3, time_min: 6 * 60 + 30 /* 06:30 = 390 */,
  override_mask: 0b10001 /* OV_SOURCE_MIN | OV_VOLUME */,
  ov_source_min_pct: 20, ov_dest_max_pct: 95,
  ov_max_runtime_min: 45, ov_target_duration_s: 1800, ov_target_volume_l: 500,
};
const bytes = serializeAutomationSet(0x0d52, [a]);
const dv = new DataView(bytes.buffer);
assert(bytes.length === 6 + 20 + 16, "header + 1 record + 1 id = 42 bytes", `got ${bytes.length}`);
// header
assert(dv.getUint16(0, true) === AUTOMATION_WIRE_MAGIC, "magic_version @0");
assert(dv.getUint16(2, true) === 0x0d52, "route_set_version @2");
assert(dv.getUint8(4) === 1, "count @4");
// record @6
assert(dv.getUint8(6) === 1, "enabled @6");
assert(dv.getUint8(7) === 0, "trigger_type @7");
assert(dv.getUint8(8) === 0b0101010, "days_mask @8");
assert(dv.getUint8(9) === 80, "level_threshold_pct @9");
assert(dv.getUint16(10, true) === 3, "route_index @10");
assert(dv.getUint16(12, true) === 390, "time_min @12 (06:30)");
assert(dv.getUint8(14) === 0b10001, "override_mask @14");
assert(dv.getUint8(15) === 20, "ov_source_min_pct @15");
assert(dv.getUint8(16) === 95, "ov_dest_max_pct @16");
assert(dv.getUint8(17) === 0, "_pad @17");
assert(dv.getUint16(18, true) === 45, "ov_max_runtime_min @18");
assert(dv.getUint16(20, true) === 1800, "ov_target_duration_s @20");
assert(dv.getUint32(22, true) === 500, "ov_target_volume_l @22");
// trailing id block @26: the whole id as ascii, null-padded to 16
const idOff = AUTOMATION_HEADER_BYTES + AUTOMATION_RECORD_BYTES;
let idStr = "";
for (let j = 0; j < AUTOMATION_ID_BYTES && bytes[idOff + j] !== 0; j++) idStr += String.fromCharCode(bytes[idOff + j]);
assert(idStr === AUTO_ID, "automation id @26 round-trips", `got "${idStr}"`);
assert(bytes[idOff + AUTOMATION_ID_BYTES - 1] === 0, "id field null-padded");

// --- Empty set: a valid 6-byte header with count 0 (never zero-length) ---
const empty = serializeAutomationSet(0x0d52, []);
assert(empty.length === 6 && new DataView(empty.buffer).getUint8(4) === 0, "empty set = 6-byte header, count 0");

// --- Firmware struct must match the layout + bake the version ---
const topology = parseTopology(parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")));
const manifest: Manifest = topologyToManifestForController(topology, topology.controllers[0]?.id ?? "default");
const files = generateAll(manifest, loadBoard(BOARD_DIR), "test-site", undefined, createTestMetadata(), {});
const get = (n: string) => files.find((f) => f.relativePath.endsWith(n))?.content ?? "";

// The struct + static_assert + wire constants now live in the vendored maji_automations
// component (a fixed file shared by every site), not the generated header. Pin the
// component source's constants against the @core SSOT so the firmware layout can't drift.
const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const CORE_H = fs.readFileSync(path.join(ROOT, "firmware/components/maji_automations/core.h"), "utf-8");

assert(CORE_H.includes(`AUTOMATION_RECORD_BYTES = ${AUTOMATION_RECORD_BYTES}`), "component record size matches SSOT");
assert(CORE_H.includes(`AUTOMATION_WIRE_MAGIC = 0x${AUTOMATION_WIRE_MAGIC.toString(16)}`), "component magic matches SSOT");
assert(CORE_H.includes(`AUTOMATION_ID_BYTES = ${AUTOMATION_ID_BYTES}`), "component id-bytes match SSOT");
assert(CORE_H.includes(`MAX_AUTOMATIONS = ${MAX_AUTOMATIONS}`), "component max-automations matches SSOT");
assert(CORE_H.includes("static_assert(sizeof(RuntimeAutomation) == AUTOMATION_RECORD_BYTES"), "component static_assert pins the record size");
// field order in the struct (the golden vector above assumes exactly this order)
const order = ["enabled", "trigger_type", "days_mask", "level_threshold_pct", "route_index",
  "time_min", "override_mask", "ov_source_min_pct", "ov_dest_max_pct", "_pad",
  "ov_max_runtime_min", "ov_target_duration_s", "ov_target_volume_l"];
const structBody = CORE_H.slice(CORE_H.indexOf("struct RuntimeAutomation"), CORE_H.indexOf("#pragma pack(pop)"));
let lastIdx = -1, ordered = true;
for (const f of order) { const idx = structBody.indexOf(` ${f};`); if (idx < lastIdx) ordered = false; lastIdx = idx; }
assert(ordered, "component struct field order matches the wire layout");

// The device gates a delivered set against its baked route_set_version — now config, not a
// header constant. Assert the generated maji_automations config carries the matching value.
const autoYaml = get("automation-engine.yaml");
assert(autoYaml.includes(`route_set_version: ${routeSetVersion(manifest)}`), "automation-engine.yaml bakes the matching route_set_version");

console.log(`\n========================================`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
