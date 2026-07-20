/**
 * Local UI (maji_local_ui) — pins the gated emission on the topology flag
 * local.ui: the package + assets-header files, the device-YAML wiring (package
 * include + esphome includes), the web_server ↔ web_server_base swap (with
 * captive_portal retained in both modes), the snapshot push hook in mqtt.yaml,
 * and the shared command dispatch (MQTT-identical body, minus firmware_update).
 *
 * Usage: npx tsx test/local-ui.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { gunzipSync } from "fflate";
import { parseTopology, topologyToManifestForController, type Manifest } from "@core";
import { generateAll, createTestMetadata, generateBoardPackage, generateLocalUiAssetsHeader, type GeneratedFile } from "@core/codegen";
import { makeAsserter, loadBoard } from "./helpers";

const { assert, done } = makeAsserter();

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const KC868_DIR = path.join(ROOT, "defaults", "boards", "kc868-a16");
const KC868_CONFIG = path.join(ROOT, "defaults", "configs", "kc868-a16-controller.yaml");

const kc868 = loadBoard(KC868_DIR);

function manifestWithUi(ui: boolean): Manifest {
  const raw = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, unknown>;
  (raw.controllers as Array<Record<string, unknown>>)[0].local = ui ? { ui: true } : undefined;
  const topo = parseTopology(raw);
  return topologyToManifestForController(topo, topo.controllers[0].id);
}

const get = (files: GeneratedFile[], suffix: string) => files.find(f => f.relativePath.endsWith(suffix));
const deviceYaml = (files: GeneratedFile[]) =>
  files.find(f => f.relativePath.endsWith(".yaml") && !f.relativePath.includes("packages/") && !f.relativePath.includes("common/"))!;

/** Extract the LOCAL_UI_INDEX_GZ bytes from the generated header and gunzip them. */
function gunzipHeader(hdr: string): string {
  const bytes = (hdr.match(/0x[0-9a-f]{2}/g) ?? []).map(h => parseInt(h, 16));
  return new TextDecoder().decode(gunzipSync(new Uint8Array(bytes)));
}

const offManifest = manifestWithUi(false);
const onManifest = manifestWithUi(true);
assert(onManifest.device.local?.ui === true, "local.ui threads topology → manifest");
assert(!offManifest.device.local?.ui, "default topology has no local.ui");

const offFiles = generateAll(offManifest, kc868, "test-site", undefined, createTestMetadata(), {});
const onFiles = generateAll(onManifest, kc868, "test-site", undefined, createTestMetadata(), {});

const offDevice = deviceYaml(offFiles).content;
const onDevice = deviceYaml(onFiles).content;
const offBoard = get(offFiles, "common/board.yaml")!.content;
const onBoard = get(onFiles, "common/board.yaml")!.content;
const offMqtt = get(offFiles, "packages/mqtt.yaml")!.content;
const onMqtt = get(onFiles, "packages/mqtt.yaml")!.content;

// --- Gated OFF: behavior unchanged ------------------------------------------------

assert(!get(offFiles, "packages/local-ui.yaml"), "off: no local-ui.yaml in the bundle");
assert(!get(offFiles, "packages/local-ui-assets.h"), "off: no local-ui-assets.h in the bundle");
assert(!offDevice.includes("local-ui"), "off: device YAML references no local-ui package/header");
assert(offBoard.includes("web_server:"), "off: stock web_server dashboard emitted");
assert(offBoard.includes("port: 80"), "off: web_server stays on port 80");
assert(!offBoard.includes("web_server_base:"), "off: no bare web_server_base");
assert(offMqtt.includes("if (!mc->is_connected()) return;"), "off: snapshot still gated on broker connection");
assert(!offMqtt.includes("push_snapshot"), "off: no SSE fan-out in the snapshot script");

// --- Gated ON: package + header files, device-YAML wiring -------------------------

const onPkg = get(onFiles, "packages/local-ui.yaml");
const onHdr = get(onFiles, "packages/local-ui-assets.h");
assert(!!onPkg, "on: bundle carries packages/local-ui.yaml");
assert(!!onHdr, "on: bundle carries packages/local-ui-assets.h");
assert(onDevice.includes("local_ui: !include packages/local-ui.yaml"), "on: device YAML includes the package");
assert(onDevice.includes("- packages/local-ui-assets.h"), "on: esphome includes carries the assets header");
assert(onDevice.includes("- packages/time-sync.h"), "on: time-sync include retained");

// --- web_server ↔ web_server_base swap, captive_portal retained -------------------

assert(!onBoard.includes("web_server:"), "on: stock web_server dashboard NOT emitted");
assert(onBoard.includes("web_server_base:"), "on: bare web_server_base emitted instead");
// kc868 defaults to ethernet (no captive_portal either way) — check the wifi
// transport, where the AP setup page must survive the swap in BOTH modes.
const wifiOff = generateBoardPackage(kc868, { mode: "dhcp", transport: "wifi" }, false);
const wifiOn = generateBoardPackage(kc868, { mode: "dhcp", transport: "wifi" }, true);
assert(wifiOff.includes("captive_portal"), "off (wifi): captive_portal retained");
assert(wifiOff.includes("web_server:"), "off (wifi): web_server emitted");
assert(wifiOn.includes("captive_portal"), "on (wifi): captive_portal retained (depends only on web_server_base)");
assert(wifiOn.includes("web_server_base:") && !wifiOn.includes("web_server:"), "on (wifi): swap applies on wifi too");
assert(wifiOn.includes("improv_serial"), "on (wifi): improv_serial untouched");

// --- Snapshot fan-out in mqtt.yaml -------------------------------------------------

assert(onMqtt.includes("id(local_ui).push_snapshot(buf);"), "on: snapshot script feeds the SSE stream");
assert(onMqtt.includes('if (mc->is_connected()) mc->publish("majiflow/test-site/'), "on: MQTT publish stays connection-gated");
assert(!onMqtt.includes("if (!mc->is_connected()) return;"), "on: snapshot builds even with the broker down (the no-server path)");

// --- Endpoint glue in local-ui.yaml ------------------------------------------------

const pkg = onPkg!.content;
assert(pkg.includes("maji_local_ui:"), "pkg: maji_local_ui config emitted");
assert(pkg.includes("id: local_ui"), "pkg: component id matches the mqtt push_snapshot reference");
assert(pkg.includes("control_id: control") && pkg.includes("autos_id: autos"), "pkg: control/autos wired");
assert(pkg.includes("set_index_asset(LOCAL_UI_INDEX_GZ, LOCAL_UI_INDEX_GZ_LEN)"), "pkg: asset blob wired from the header");
assert(pkg.includes("set_command_handler("), "pkg: command handler installed");
assert(pkg.includes("set_automations_handler("), "pkg: automations handler installed");
assert(pkg.includes("id(autos).apply_set("), "pkg: automations blob applied via apply_set (persists to NVS)");
assert(!pkg.includes('reject = "STALE"'), "pkg: no TTL read on the httpd task (cross-thread read removed)");
assert(pkg.includes('record_outcome(command_id, "REFUSED", "STALE")'), "pkg: issued_at TTL enforced in the main-loop dispatch body");
assert(pkg.includes('reject = "UNKNOWN_ACTION"'), "pkg: unknown actions refused before dispatch");
assert(pkg.includes("id(local_ui).defer("), "pkg: dispatch marshalled to the main loop");

// --- Shared dispatch parity with the MQTT lane -------------------------------------

// One emitter feeds both lanes: a distinctive line of the dispatch body must appear
// verbatim in both the MQTT handler and the local-UI deferred lambda.
const dispatchLine = "int rc = id(control).start_route(route_id, command_id, spec, maji_ctl::ORIGIN_MANUAL, actor);";
assert(onMqtt.includes(dispatchLine), "parity: MQTT handler carries the dispatch body");
assert(pkg.includes(dispatchLine), "parity: local-UI glue carries the SAME dispatch body");
assert(onMqtt.includes('"firmware_update"'), "parity: MQTT lane keeps firmware_update (cert-pinned)");
assert(!pkg.includes('"firmware_update"'), "parity: local lane drops firmware_update (unauthenticated LAN)");
assert(!pkg.includes("route_set_version"), "pkg: automation route_set_version is baked as a number, not a config key");

// --- Assets header: gzip blob + placeholder page ------------------------------------

const hdr = onHdr!.content;
assert(hdr.includes("static const uint8_t LOCAL_UI_INDEX_GZ[] PROGMEM"), "hdr: PROGMEM gzip blob emitted");
assert(hdr.includes("static const size_t LOCAL_UI_INDEX_GZ_LEN"), "hdr: length constant emitted");
assert(hdr.includes("0x1f, 0x8b"), "hdr: blob starts with the gzip magic");
const page = gunzipHeader(hdr);
assert(page.includes(onManifest.device.friendly_name), "hdr: placeholder page names the device");
assert(page.includes("local operator UI will live here"), "hdr: placeholder page text");
assert(generateLocalUiAssetsHeader(onManifest) === hdr, "hdr: generator is deterministic for the same manifest");

done();
