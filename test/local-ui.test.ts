/**
 * Local UI (maji_local_ui) — pins the gated emission on the topology flag
 * local.ui: the package + assets-header files, the device-YAML wiring (package
 * include + esphome includes), the web_server ↔ web_server_base swap (with
 * captive_portal retained in both modes), the snapshot push hook in mqtt.yaml,
 * the shared command dispatch (MQTT-identical body, minus firmware_update), and
 * the asset-table header: placeholder fallback when the device-app dist is absent
 * or has no device-build.json marker, real dist embedding (content types,
 * immutable flags, .map / service-worker exclusion, bytewise ordering) via a
 * fixture dist through DEVICE_UI_DIST.
 *
 * Usage: npx tsx test/local-ui.test.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
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

// Never let the tests slurp a real dist/device: default to a missing dir so
// the placeholder path is exercised unless a test points at its fixture.
const MISSING_DIST = path.join(os.tmpdir(), "local-ui-no-such-dist");
process.env.DEVICE_UI_DIST = MISSING_DIST;

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

/** Gunzip one named asset array out of the generated header. */
function gunzipArray(hdr: string, name: string): string {
  // Anchor on the closing "\n};" — a gzip byte 0x7d ('}') inside the blob would
  // truncate a naive [^}]* match.
  const body = hdr.match(new RegExp(name + "\\[\\] PROGMEM = \\{([\\s\\S]*?)\\n\\};"))?.[1] ?? "";
  const bytes = (body.match(/0x[0-9a-f]{2}/g) ?? []).map(h => parseInt(h, 16));
  return new TextDecoder().decode(gunzipSync(new Uint8Array(bytes)));
}

/** The LOCAL_UI_ASSETS table entry for a serve path: {name, contentType, immutable}. */
function tableEntry(hdr: string, servePath: string) {
  const m = hdr.match(
    new RegExp(
      `\\{"${servePath.replace(/[/.]/g, "\\$&")}", (LOCAL_UI_ASSET_\\d+), sizeof\\(\\1\\), "([^"]+)", (true|false)\\}`,
    ),
  );
  return m ? { name: m[1], contentType: m[2], immutable: m[3] === "true" } : null;
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
assert(pkg.includes("set_assets(LOCAL_UI_ASSETS, LOCAL_UI_ASSETS_COUNT)"), "pkg: asset table wired from the header");
assert(pkg.includes("set_command_handler("), "pkg: command handler installed");
assert(pkg.includes("set_automations_handler("), "pkg: automations handler installed");
assert(pkg.includes("id(autos).apply_set("), "pkg: automations blob applied via apply_set (persists to NVS)");
assert(!pkg.includes('reject = "STALE"'), "pkg: no TTL read on the httpd task (cross-thread read removed)");
assert(pkg.includes('record_outcome(command_id, "REFUSED", "STALE")'), "pkg: issued_at TTL enforced in the main-loop dispatch body");
assert(pkg.includes('reject = "UNKNOWN_ACTION"'), "pkg: unknown actions refused before dispatch");
assert(pkg.includes("id(local_ui).defer_to_loop("), "pkg: dispatch marshalled to the main loop (defer_to_loop — Component::defer is protected)");

// --- Shared dispatch parity with the MQTT lane -------------------------------------

// One emitter feeds both lanes: a distinctive line of the dispatch body must appear
// verbatim in both the MQTT handler and the local-UI deferred lambda.
const dispatchLine = "int rc = id(control).start_route(route_id, command_id, spec, maji_ctl::ORIGIN_MANUAL, actor);";
assert(onMqtt.includes(dispatchLine), "parity: MQTT handler carries the dispatch body");
assert(pkg.includes(dispatchLine), "parity: local-UI glue carries the SAME dispatch body");
assert(onMqtt.includes('"firmware_update"'), "parity: MQTT lane keeps firmware_update (cert-pinned)");
assert(!pkg.includes('"firmware_update"'), "parity: local lane drops firmware_update (unauthenticated LAN)");
assert(!pkg.includes("route_set_version"), "pkg: automation route_set_version is baked as a number, not a config key");

// --- Assets header: placeholder table when the dist is absent -------------------

const hdr = onHdr!.content;
assert(hdr.includes('#include "esphome/components/maji_local_ui/core.h"'), "hdr: asset struct pulled from the component core");
assert(hdr.includes("static const uint8_t LOCAL_UI_ASSET_0[] PROGMEM"), "hdr: PROGMEM gzip blob emitted");
assert(hdr.includes("static const maji_localui::LocalUiAsset LOCAL_UI_ASSETS[]"), "hdr: asset table emitted");
assert(hdr.includes("static const size_t LOCAL_UI_ASSETS_COUNT"), "hdr: table count emitted");
assert(hdr.includes("0x1f, 0x8b"), "hdr: blob starts with the gzip magic");
const idxEntry = tableEntry(hdr, "/");
assert(!!idxEntry && idxEntry.contentType === "text/html" && !idxEntry.immutable,
  "hdr: placeholder is the single \"/\" entry (text/html, not immutable)");
assert((hdr.match(/\{\"\//g) ?? []).length === 1, "hdr: placeholder table has exactly one entry");
const page = gunzipArray(hdr, idxEntry!.name);
assert(page.includes(onManifest.device.friendly_name), "hdr: placeholder page names the device");
assert(page.includes("local operator UI will live here"), "hdr: placeholder page text");
assert(generateLocalUiAssetsHeader(onManifest) === hdr, "hdr: generator is deterministic for the same manifest");

// --- Assets header: real dist via DEVICE_UI_DIST ---------------------------------

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "local-ui-dist-"));
fs.mkdirSync(path.join(fixture, "assets"));
fs.mkdirSync(path.join(fixture, "fonts"));
fs.writeFileSync(path.join(fixture, "index.html"), "<!doctype html><title>fixture app</title>");
fs.writeFileSync(path.join(fixture, "main-ABC123XY.js"), "console.log('fixture bundle');");
fs.writeFileSync(path.join(fixture, "main-ABC123XY.js.map"), "{\"mappings\":\"AAAA\"}");
fs.writeFileSync(path.join(fixture, "styles.css"), "body{color:#000}");
fs.writeFileSync(path.join(fixture, "assets", "logo.svg"), "<svg/>");
fs.writeFileSync(path.join(fixture, "fonts", "inter-400.woff2"), "wOF2fixture");
// Uppercase-first name: bytewise it sorts before main-…, localeCompare after.
fs.writeFileSync(path.join(fixture, "Zebra.css"), ".z{color:#fff}");
// Service-worker files — device mode disables the SW; never embedded.
for (const sw of ["ngsw-worker.js", "ngsw.json", "safety-worker.js", "worker-basic.min.js"])
  fs.writeFileSync(path.join(fixture, sw), "sw");
// The device-build marker (scripts/build-device.mjs) — without it the dist is
// treated as a cloud/stale build and the placeholder is embedded instead.
fs.writeFileSync(
  path.join(fixture, "device-build.json"),
  JSON.stringify({
    config: "defaults/configs/kc868-a16-controller.yaml",
    builtAt: "2026-07-21T00:00:00.000Z",
    topologySha256: "deadbeef",
  }),
);
process.env.DEVICE_UI_DIST = fixture;

const logs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
const real = generateLocalUiAssetsHeader(onManifest);
console.log = origLog;
process.env.DEVICE_UI_DIST = MISSING_DIST;

assert(logs.some(l => l.includes("device build of defaults/configs/kc868-a16-controller.yaml")),
  "fixture: embed summary logs the config path from the marker");

const jsEntry = tableEntry(real, "/main-ABC123XY.js");
assert(!!jsEntry, "fixture: hashed js embedded");
assert(jsEntry?.contentType === "text/javascript", "fixture: js content-type");
assert(jsEntry?.immutable === true, "fixture: hashed js is immutable");
assert(gunzipArray(real, jsEntry?.name ?? "LOCAL_UI_ASSET_X").includes("fixture bundle"),
  "fixture: js array gunzips to the real bytes");
assert((real.match(/0x1f, 0x8b/g) ?? []).length >= 5, "fixture: every array starts with the gzip magic");

const realIdx = tableEntry(real, "/");
assert(realIdx?.contentType === "text/html" && realIdx.immutable === false, "fixture: index is text/html, not immutable");
assert(gunzipArray(real, realIdx?.name ?? "LOCAL_UI_ASSET_X").includes("fixture app"), "fixture: index gunzips");

const cssEntry = tableEntry(real, "/styles.css");
assert(cssEntry?.contentType === "text/css" && cssEntry.immutable === false, "fixture: unhashed css is not immutable");
assert(!!tableEntry(real, "/assets/logo.svg"), "fixture: nested file served by full path");
assert(tableEntry(real, "/assets/logo.svg")?.contentType === "image/svg+xml", "fixture: svg content-type");
assert(!tableEntry(real, "/fonts/inter-400.woff2"), "fixture: self-hosted fonts are never embedded (system-font fallback on device)");
assert(!real.includes(".map"), "fixture: .map files are never embedded");
assert(!real.includes("device-build"), "fixture: the marker itself is never embedded");
for (const sw of ["ngsw-worker.js", "ngsw.json", "safety-worker.js", "worker-basic.min.js"])
  assert(!real.includes(sw), `fixture: ${sw} is never embedded (SW disabled in device mode)`);
// Bytewise, "Zebra.css" sorts before "main-…" ('Z' < 'm'); localeCompare would
// put it after — pin the reproducible order.
assert(real.indexOf('"/Zebra.css"') !== -1 && real.indexOf('"/Zebra.css"') < real.indexOf('"/main-ABC123XY.js"'),
  "fixture: assets ordered bytewise, not locale-dependent");
assert(/Embedded: 5 file\(s\)/.test(real), "fixture: header comment reports the embedded file count");

// A dist WITHOUT the marker (or with an unparseable one) is not a device build —
// the placeholder goes in, with a warning naming the fix.
const noMarker = fs.mkdtempSync(path.join(os.tmpdir(), "local-ui-nomarker-"));
fs.writeFileSync(path.join(noMarker, "index.html"), "<!doctype html><title>cloud build</title>");
const warns: string[] = [];
const origWarn = console.warn;
console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));
process.env.DEVICE_UI_DIST = noMarker;
const noMarkerHdr = generateLocalUiAssetsHeader(onManifest);
assert(noMarkerHdr === hdr, "no marker: dist without device-build.json falls back to the placeholder");
assert(warns.some(w => w.includes("device-build.json") && w.includes("npm run build:device -- <config>")),
  "no marker: warning names the fix");

warns.length = 0;
fs.writeFileSync(path.join(noMarker, "device-build.json"), "{not json");
const badMarkerHdr = generateLocalUiAssetsHeader(onManifest);
console.warn = origWarn;
process.env.DEVICE_UI_DIST = MISSING_DIST;
assert(badMarkerHdr === hdr, "bad marker: unparseable device-build.json falls back to the placeholder");
assert(warns.some(w => w.includes("device-build.json")), "bad marker: unparseable marker warns");
fs.rmSync(noMarker, { recursive: true, force: true });

// Missing dist (env restored above) → placeholder again, still a valid header.
const backToPlaceholder = generateLocalUiAssetsHeader(onManifest);
assert(backToPlaceholder === hdr, "fixture: missing dist falls back to the placeholder table");

fs.rmSync(fixture, { recursive: true, force: true });

done();
