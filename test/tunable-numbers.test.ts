/**
 * Drift guard: the runtime tunable-number enumeration MUST match exactly the
 * `number:` entities the firmware codegen emits — same ids and same bounds.
 *
 * This is the single-source-of-truth enforcement: collectTunableNumbers (read by
 * the firmware config_set handler, the dashboard editors, and the convergence
 * descriptor) and the generated YAML cannot silently diverge, or config_set would
 * target a key the device doesn't expose, or the UI would show a wrong range.
 *
 * Usage: npm run test:tunables
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology, topologyToManifestForController, collectTunableNumbers, type Manifest,
} from "@core";
import { generateAll, createTestMetadata } from "@core/codegen";
import { loadBoard } from "./helpers";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");
const BOARD_DIR = path.join(DEFAULTS, "boards/heltec-v3");

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const board = loadBoard(BOARD_DIR);
const topology = parseTopology(parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")));
const manifest: Manifest = topologyToManifestForController(topology, topology.controllers[0]?.id ?? "default");
const files = generateAll(manifest, board, "test-site", undefined, createTestMetadata(), {});

// Parse the emitted `number:` entities (they live in the sensors file).
const sensorsYaml = files.find((f) => f.relativePath.endsWith("sensors.yaml"))?.content ?? "";
const doc = parseYaml(sensorsYaml) as { number?: Array<{ id: string; min_value: number; max_value: number; step: number }> };
const emitted = new Map((doc.number ?? []).map((nm) => [nm.id, nm]));
const tunables = collectTunableNumbers(manifest);
const tunableKeys = new Set(tunables.map((t) => t.key));

console.log("Tunable-number drift guard");
console.log("==========================\n");

// Coverage sanity: the enumeration isn't trivially empty and spans every tier/scope.
assert(tunables.some((t) => t.key === "claim_lease_s"), "controller numbers enumerated (claim_lease_s)");
assert(tunables.some((t) => t.field === "max_runtime"), "route runtime enumerated (max_runtime)");
assert(tunables.some((t) => t.tier === "calibration" && t.field === "cal_empty"), "calibration enumerated (cal_empty)");

// Every emitted number is enumerated (no orphan the UI/config_set can't reach).
const orphans = [...emitted.keys()].filter((id) => !tunableKeys.has(id));
assert(orphans.length === 0, "every emitted number: id is in collectTunableNumbers", orphans.join(", "));

// Every enumerated number is actually emitted (no key config_set would miss).
const missing = tunables.filter((t) => !emitted.has(t.key)).map((t) => t.key);
assert(missing.length === 0, "every collectTunableNumbers key is emitted on the device", missing.join(", "));

// Bounds match exactly (so the UI range == the device's number range).
const mismatched = tunables
  .filter((t) => emitted.has(t.key))
  .filter((t) => {
    const e = emitted.get(t.key)!;
    return e.min_value !== t.min || e.max_value !== t.max || e.step !== t.step;
  })
  .map((t) => `${t.key} (ui ${t.min}/${t.max}/${t.step} vs yaml ${emitted.get(t.key)!.min_value}/${emitted.get(t.key)!.max_value}/${emitted.get(t.key)!.step})`);
assert(mismatched.length === 0, "min/max/step match between UI metadata and emitted YAML", mismatched.join("; "));

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed   (${tunables.length} tunables, ${emitted.size} emitted)`);
process.exit(failed ? 1 : 0);
