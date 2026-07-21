/**
 * DS3231 RTC (local.rtc) — pins the gated emission on the topology flag:
 *
 *   - OFF (flag unset): mqtt.yaml + device YAML are BYTE-IDENTICAL to the golden
 *     files captured before the RTC feature existed (test/golden/rtc-off-*.yaml).
 *     This is the hard requirement: no RTC flag, no change. If an intentional
 *     off-path edit legitimately changes those files, re-capture with
 *     `npx tsx test/capture-rtc-golden.ts`.
 *   - ON (kc868-a16): the ds1307 platform rides the board i2c bus, SNTP writes back
 *     to the RTC on sync, the boot read restores wall clock after the persisted
 *     seed, and time_trusted is earned from EITHER source.
 *   - A board without an i2c bus ignores the flag entirely.
 *
 * Usage: npx tsx test/rtc-time.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseTopology, topologyToManifestForController, type BoardDef, type Manifest } from "@core";
import { generateAll, createTestMetadata, type GeneratedFile } from "@core/codegen";
import { makeAsserter, loadBoard } from "./helpers";

const { assert, done } = makeAsserter();

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const GOLDEN = path.join(ROOT, "test", "golden");
const KC868_CONFIG = path.join(ROOT, "defaults", "configs", "kc868-a16-controller.yaml");

const kc868 = loadBoard(path.join(ROOT, "defaults", "boards", "kc868-a16"));

function manifestWithLocal(local: unknown): Manifest {
  const raw = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, any>;
  raw.controllers[0].local = local;
  const topo = parseTopology(raw);
  return topologyToManifestForController(topo, topo.controllers[0].id);
}

const get = (files: GeneratedFile[], suffix: string) => files.find(f => f.relativePath.endsWith(suffix));
const deviceYaml = (files: GeneratedFile[]) =>
  files.find(f => f.relativePath.endsWith(".yaml") && !f.relativePath.includes("packages/") && !f.relativePath.includes("common/"))!;
const gen = (m: Manifest, board: BoardDef) => generateAll(m, board, "test-site", undefined, createTestMetadata(), {});

// async main: generateAll is async (manifest-driven local-UI assets).
const main = async () => {
const offFiles = await gen(manifestWithLocal(undefined), kc868);
const onFiles = await gen(manifestWithLocal({ rtc: true }), kc868);

const offMqtt = get(offFiles, "packages/mqtt.yaml")!.content;
const onMqtt = get(onFiles, "packages/mqtt.yaml")!.content;
const offDevice = deviceYaml(offFiles).content;
const onDevice = deviceYaml(onFiles).content;

// --- Gated OFF: byte-identical to the pre-RTC golden -------------------------------

const goldenMqtt = fs.readFileSync(path.join(GOLDEN, "rtc-off-mqtt.yaml"), "utf-8");
const goldenDevice = fs.readFileSync(path.join(GOLDEN, "rtc-off-device.yaml"), "utf-8");
assert(offMqtt === goldenMqtt, "off: mqtt.yaml byte-identical to the pre-RTC golden");
assert(offDevice === goldenDevice, "off: device YAML byte-identical to the pre-RTC golden");
assert(offFiles.every(f => !f.content.includes("ds1307") && !f.content.includes("rtc_time")),
  "off: no ds1307/rtc_time reference anywhere in the bundle");

// Explicit rtc:false and an empty local object gate the same way as unset.
for (const [label, local] of [["rtc: false", { rtc: false }], ["empty local", {}]] as const) {
  const files = await gen(manifestWithLocal(local), kc868);
  assert(get(files, "packages/mqtt.yaml")!.content === goldenMqtt, `off (${label}): mqtt.yaml still byte-identical`);
  assert(deviceYaml(files).content === goldenDevice, `off (${label}): device YAML still byte-identical`);
}

// --- Gated ON: only mqtt.yaml + the device YAML change ------------------------------
// (secrets.yaml is re-randomized every run — excluded from the comparison.)

const offMap = new Map(offFiles.map(f => [f.relativePath, f.content]));
const allowed = ["packages/mqtt.yaml", "secrets.yaml", deviceYaml(onFiles).relativePath];
const unexpected = onFiles.filter(f =>
  offMap.get(f.relativePath) !== f.content && !allowed.some(a => f.relativePath.endsWith(a)));
assert(unexpected.length === 0, "on: no other file changes",
  unexpected.map(f => f.relativePath).join(", "));

// --- Gated ON: ds1307 platform, i2c reference, SNTP write-back, dual trust ----------

assert(onMqtt.includes("- platform: ds1307"), "on: ds1307 time platform emitted");
assert(onMqtt.includes("id: rtc_time"), "on: rtc clock id emitted");
assert(onMqtt.includes("i2c_id: i2c_bus"), "on: ds1307 rides the board i2c bus (id i2c_bus)");
assert(!onMqtt.includes("address:"), "on: address left at the ds1307 default 0x68 (DS3231)");
const timeSection = onMqtt.slice(onMqtt.indexOf("\ntime:"), onMqtt.indexOf("\ninterval:"));
assert(timeSection.includes("- ds1307.write_time:\n              id: rtc_time"),
  "on: SNTP on_time_sync writes the synced time back to the RTC");
assert((timeSection.match(/id\(time_trusted\) = true;/g) ?? []).length === 2,
  "on: time_trusted earned from BOTH sources (SNTP sync + valid RTC read)");
assert(timeSection.indexOf("platform: sntp") < timeSection.indexOf("platform: ds1307"),
  "on: sntp_time stays the consumer clock (declared first, unchanged id)");
assert(onMqtt.includes("id(sntp_time).now()"), "on: consumers still read the one sntp_time clock face");

// --- Gated ON: boot restore ordering -------------------------------------------------

assert(onDevice.includes("- ds1307.read_time: rtc_time"), "on: boot restores wall clock from the RTC");
const seedAt = onDevice.indexOf("priority: -100");
const rtcAt = onDevice.indexOf("priority: -200");
assert(seedAt >= 0 && rtcAt > seedAt, "on: RTC read runs after the persisted-clock seed (priority -200 < -100)");
assert(!goldenDevice.includes("ds1307.read_time"), "off: golden has no RTC boot step (pin cross-check)");

// --- Board without i2c: flag ignored --------------------------------------------------

const noI2c: BoardDef = { ...kc868, buses: {} };
const noI2cFiles = await gen(manifestWithLocal({ rtc: true }), noI2c);
assert(noI2cFiles.every(f => !f.content.includes("ds1307") && !f.content.includes("rtc_time")),
  "no-i2c: local.rtc ignored — no ds1307 anywhere");
assert(get(noI2cFiles, "packages/mqtt.yaml")!.content === goldenMqtt,
  "no-i2c: mqtt.yaml byte-identical to the golden (SNTP-only)");

done();
};
void main();
