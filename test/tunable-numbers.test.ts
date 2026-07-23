/**
 * Drift guard: the runtime tunable-number enumeration MUST match exactly the
 * `number:` entities the firmware codegen emits — same ids and same bounds — and
 * the tunable persistence/echo model MUST hold:
 *   - each tunable `number:` declares restore_value: true, so a local config_set
 *     (on-device dashboard, no server) survives reboots. The cloud stays
 *     authoritative when connected: the retained /config message re-applies the
 *     server's desired values on every (re)connect, overriding a persisted local
 *     change.
 *   - every tunable key echoes its live value into the snapshot `readings` block,
 *     so the app shadow (cloud and on-device) shows current values with no
 *     separate read path.
 *
 * This is the single-source-of-truth enforcement: collectTunableNumbers (read by the
 * firmware config-apply dispatch, the local config_set allow-list, the dashboard
 * editors that write the desired bag, and tunableKvKeys — the server's /config
 * kv-key contract) and the generated YAML cannot silently diverge, or the device
 * would apply a key it doesn't expose, or the UI would show a wrong range.
 *
 * Usage: npm run test:tunables
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseTopology, topologyToManifestForController, collectTunableNumbers, tunableKvKeys, type Manifest,
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
// async main: generateAll is async (manifest-driven local-UI assets).
const main = async () => {
const files = await generateAll(manifest, board, "test-site", undefined, createTestMetadata(), {});

// Parse the emitted `number:` entities (they live in the sensors file).
const sensorsYaml = files.find((f) => f.relativePath.endsWith("sensors.yaml"))?.content ?? "";
const doc = parseYaml(sensorsYaml) as { number?: Array<{ id: string; min_value: number; max_value: number; step: number; restore_value?: boolean }> };
const emitted = new Map((doc.number ?? []).map((nm) => [nm.id, nm]));
const tunables = collectTunableNumbers(manifest);
const tunableKeys = new Set(tunables.map((t) => t.key));

// The snapshot (mqtt.yaml) — the device's single source-of-truth message. Every
// tunable key echoes its live value into the readings block (the app shadow, cloud
// and on-device, reads current values straight from the snapshot).
const mqttYaml = files.find((f) => f.relativePath.endsWith("mqtt.yaml"))?.content ?? "";

console.log("Tunable-number drift guard");
console.log("==========================\n");

// Coverage sanity: the enumeration isn't trivially empty and spans every tier/scope.
assert(tunables.some((t) => t.key === "claim_lease_s"), "controller numbers enumerated (claim_lease_s)");
assert(tunables.some((t) => t.field === "max_runtime"), "route runtime enumerated (max_runtime)");
assert(tunables.some((t) => t.tier === "calibration" && t.field === "cal_empty"), "calibration enumerated (cal_empty)");

// Every emitted number is enumerated (no orphan the desired-config can't reach).
const orphans = [...emitted.keys()].filter((id) => !tunableKeys.has(id));
assert(orphans.length === 0, "every emitted number: id is in collectTunableNumbers", orphans.join(", "));

// Every enumerated number is actually emitted (no key the desired-config would miss).
const missing = tunables.filter((t) => !emitted.has(t.key)).map((t) => t.key);
assert(missing.length === 0, "every collectTunableNumbers key is emitted on the device", missing.join(", "));

// tunableKvKeys() is the server's /config kv-key contract: it MUST be exactly the
// enumerated tunable keys, in the same stable order (the server packs the payload
// and the firmware config-apply dispatch is generated against this one list).
const kvKeys = tunableKvKeys(manifest);
assert(
  kvKeys.length === tunables.length && kvKeys.every((k, i) => k === tunables[i].key),
  "tunableKvKeys() == collectTunableNumbers() keys, same order",
  `kv [${kvKeys.join(",")}] vs tunables [${tunables.map((t) => t.key).join(",")}]`,
);

// Persistent: EVERY tunable number declares restore_value: true — a local
// config_set (on-device dashboard, no server) survives reboots. The cloud stays
// authoritative when connected: the retained /config re-apply on every (re)connect
// overrides the persisted value.
const notRestored = tunables
  .filter((t) => emitted.has(t.key))
  .filter((t) => emitted.get(t.key)!.restore_value !== true)
  .map((t) => t.key);
assert(notRestored.length === 0, "every tunable number: declares restore_value (local config_set survives reboots)", notRestored.join(", "));

// Snapshot echo: the readings block of the device snapshot MUST carry every
// tunable key's live value (the app shadow shows current values with no separate
// read path). The readings block runs from `\"readings\":{` to `\"text\":{`;
// every tunable key must appear there.
const rStart = mqttYaml.indexOf('\\"readings\\":{');
const rEnd = mqttYaml.indexOf('},\\"text\\":{');
assert(rStart >= 0 && rEnd > rStart, "snapshot has a readings block then a text block");
const readingsBlock = mqttYaml.slice(rStart, rEnd);
const notEchoed = [...tunableKeys].filter((k) => !readingsBlock.includes(`\\"${k}\\":`));
assert(notEchoed.length === 0, "every tunable key echoes its live value in the snapshot readings", notEchoed.join(", "));

// The one config field is the slimmed replacement: it rides the `text` block, never
// the readings (text-only, never written to telemetry_raw), so the snapshot still
// reports the applied config without re-ingesting config-as-telemetry.
assert(mqttYaml.includes('\\"config_version\\":'), "snapshot text carries a single config_version field");

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
};
void main();
