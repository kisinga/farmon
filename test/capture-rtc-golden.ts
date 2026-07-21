/**
 * One-shot capture: RTC-off golden output for test/rtc-time.test.ts.
 * Run from the pre-RTC working tree; the two files it writes pin the
 * "no local.rtc" byte stream the RTC feature must not alter.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseTopology, topologyToManifestForController } from "@core";
import { generateAll, createTestMetadata } from "@core/codegen";
import { loadBoard } from "./helpers";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = path.join(ROOT, "test", "golden");

const kc868 = loadBoard(path.join(ROOT, "defaults", "boards", "kc868-a16"));
const raw = parseYaml(fs.readFileSync(path.join(ROOT, "defaults", "configs", "kc868-a16-controller.yaml"), "utf-8"));
const topo = parseTopology(raw);
const manifest = topologyToManifestForController(topo, topo.controllers[0].id);
// async main: generateAll is async (manifest-driven local-UI assets).
const main = async () => {
const files = await generateAll(manifest, kc868, "test-site", undefined, createTestMetadata(), {});

const mqtt = files.find(f => f.relativePath.endsWith("packages/mqtt.yaml"))!;
const device = files.find(f => f.relativePath.endsWith(".yaml") && !f.relativePath.includes("packages/") && !f.relativePath.includes("common/"))!;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "rtc-off-mqtt.yaml"), mqtt.content);
fs.writeFileSync(path.join(OUT, "rtc-off-device.yaml"), device.content);
console.log("wrote", mqtt.relativePath, mqtt.content.length, "bytes;", device.relativePath, device.content.length, "bytes");
};
void main();
