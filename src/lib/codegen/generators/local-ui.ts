import { gzipSync } from 'fflate';
import type { Manifest } from '@core';
import { routeSetVersion } from '@core';
import { commandActionNames, commandDispatchLines } from './mqtt';

/**
 * Local UI — the operator dashboard served from the device itself (topology flag
 * local.ui). Replaces the stock ESPHome web_server v3 page: networking.ts emits a
 * bare web_server_base instead, and this package registers the maji_local_ui
 * component on it.
 *
 * Two artifacts:
 *   - local-ui.yaml      — the maji_local_ui config + the on_boot glue that installs
 *                          the asset table + the command/automations handlers (they
 *                          need id() access, so they are generated here, not baked
 *                          into the component).
 *   - local-ui-assets.h  — the device-mode app (npm run build:device →
 *                          dist/device/browser) as a flat table of gzipped
 *                          PROGMEM assets (LOCAL_UI_ASSETS /
 *                          LOCAL_UI_ASSETS_COUNT, one maji_localui::LocalUiAsset per
 *                          file). When the dist is absent or has no device-build.json
 *                          marker — tests, cloud-side codegen, a fresh checkout, a
 *                          cloud build in the same dir — a placeholder page is
 *                          embedded as the single "/" entry instead, so codegen
 *                          never requires an Angular build.
 *
 * Serving contract (component side in firmware/components/maji_local_ui):
 *   exact path match → the file (Content-Encoding: gzip, the table's Content-Type);
 *   "/" is the index; "/index.html" and unmatched extension-less GETs fall back to
 *   it (SPA deep-links); immutable entries (content-hashed names) get a year-long
 *   Cache-Control, everything else no-cache; "/local" and unknown /local/* stay
 *   strict 404s.
 *
 * Endpoint contract (shared with the app side):
 *   GET  /local/state       — SSE stream of the ControllerSnapshot JSON: the exact
 *                             bytes publish_snapshot builds for the MQTT state topic
 *                             (the script calls id(local_ui).push_snapshot, so the SSE
 *                             cadence IS the snapshot cadence, broker down or not).
 *   POST /local/command     — the MQTT command envelope, dispatched by the SAME body
 *                             as the MQTT handler (commandDispatchLines in mqtt.ts):
 *                             same record_outcome, same publish_snapshot fast-path.
 *                             The synchronous gate checks envelope + action only;
 *                             the issued_at TTL is enforced by the dispatch body on
 *                             the main loop (a stale command is accepted here, then
 *                             recorded STALE via record_outcome — as on MQTT).
 *                             200 {"command_id":...} on accept; 400 {"error":...} on
 *                             bad JSON / unknown action. Outcomes flow back via the
 *                             snapshot, as on MQTT.
 *                             firmware_update is NOT exposed here (unauthenticated LAN).
 *   POST /local/automations — raw automation wire blob (application/octet-stream):
 *                             validated with the pure kernel on a scratch table, then
 *                             id(autos).apply_set on the main loop (which persists to
 *                             NVS). 200 on APPLY_OK/APPLY_CLEARED, 400 otherwise.
 */

/** Indent each non-empty C++ line to a column (YAML block-scalar body). */
const indent = (lines: string[], n: number) =>
  lines.map(l => (l === '' ? '' : ' '.repeat(n) + l)).join('\n');

/** YAML package — the maji_local_ui config + the on_boot handler-install glue. */
export function generateLocalUiYaml(m: Manifest): string {
  // Synchronous gate (httpd task, read-only): well-formed envelope + known
  // action — then the dispatch is marshalled to the main loop, where the shared
  // dispatch body re-parses and enforces the issued_at TTL (commandDispatchLines
  // in mqtt.ts). No TTL read here: id(sntp_time)/id(time_trusted) are main-loop
  // state and must not be touched cross-thread. The action allow-list comes
  // from the same emitter as the dispatch body, so the two can't drift.
  const actionGate = commandActionNames({ allowOta: false })
    .map(a => `strcmp(action, "${a}") != 0`)
    .join(' && ');
  const commandGlue = [
    'id(local_ui).set_command_handler([](const std::string &body, std::string &reply) -> uint16_t {',
    '  std::string command_id;',
    '  const char *reject = nullptr;',
    '  bool ok = json::parse_json(body, [&](JsonObject x) -> bool {',
    '    command_id = x["command_id"] | "";',
    '    const char *action = x["action"] | "";',
    '    if (command_id.empty()) { reject = "MISSING_COMMAND_ID"; return false; }',
    `    if (${actionGate}) { reject = "UNKNOWN_ACTION"; return false; }`,
    '    return true;',
    '  });',
    '  if (!ok) {',
    '    reply = std::string("{\\"error\\":\\"") + (reject != nullptr ? reject : "BAD_JSON") + "\\"}";',
    '    return 400;',
    '  }',
    '  // Accepted: dispatch on the main loop (the route engine / claims / automation',
    '  // table are loop-thread only — see the no-lock note in maji_automations.h). The',
    '  // body is the SAME one the MQTT handler runs (commandDispatchLines in mqtt.ts,',
    '  // allowOta=false) — including the issued_at TTL gate — re-parsed inside a void',
    '  // lambda so its early returns compile.',
    '  id(local_ui).defer_to_loop([body]() {',
    '    json::parse_json(body, [&](JsonObject x) -> bool {',
    '      [&]() {',
    ...commandDispatchLines({ allowOta: false }).map(l => (l === '' ? '' : '        ' + l)),
    '      }();',
    '      return true;',
    '    });',
    '  });',
    '  // Escape into a stack buffer (json_esc_to) — json_esc\'s shared static buffer is',
    '  // main-loop-only; this handler runs on the httpd task while the snapshot builder',
    '  // escapes through the same buffer on the main loop.',
    '  char cid_esc[96];',
    '  maji_ctl::json_esc_to(cid_esc, sizeof(cid_esc), command_id.c_str());',
    '  reply = std::string("{\\"command_id\\":\\"") + cid_esc + "\\"}";',
    '  return 200;',
    '});',
  ];
  const automationsGlue = [
    'id(local_ui).set_automations_handler([](const uint8_t *data, size_t len) -> uint16_t {',
    '  // Validate with the PURE kernel on a scratch table (no shared state — the httpd',
    '  // task services requests sequentially, so the static scratch is safe), then apply',
    '  // on the main loop: tick() reads the live table there, and apply_set persists to',
    '  // NVS. A refused blob keeps the last-good set, exactly as on the MQTT lane.',
    '  static maji_auto::RuntimeAutomation scratch[maji_auto::MAX_AUTOMATIONS];',
    '  static char scratch_ids[maji_auto::MAX_AUTOMATIONS][maji_auto::AUTOMATION_ID_BYTES];',
    '  uint8_t count = 0;',
    `  auto r = maji_auto::apply_set(data, len, ${routeSetVersion(m)}, scratch, scratch_ids, count);`,
    '  if (r != maji_auto::APPLY_OK && r != maji_auto::APPLY_CLEARED) return 400;',
    '  std::string blob((const char *) data, len);',
    '  id(local_ui).defer_to_loop([blob]() { id(autos).apply_set((const uint8_t *) blob.data(), blob.size()); });',
    '  return 200;',
    '});',
  ];
  const bootBody = [
    'id(local_ui).set_assets(LOCAL_UI_ASSETS, LOCAL_UI_ASSETS_COUNT);',
    ...commandGlue,
    ...automationsGlue,
  ];

  return `# =============================================================================
# MajiFlow — Local UI (operator dashboard served from the device)
# =============================================================================
# AUTO-GENERATED. Emitted when the topology's local.ui flag is on; replaces the
# stock ESPHome web_server v3 page (networking.ts emits a bare web_server_base
# instead — captive_portal is unaffected, it depends only on web_server_base).
#
# Endpoints (shared web_server_base, port 80):
#   GET  /                   — the device-mode app index (local-ui-assets.h: a flat
#                              table of gzipped PROGMEM files). Exact asset paths
#                              serve their file; extension-less navigation GETs
#                              outside /local/ fall back to this index (SPA routes).
#                              Hashed assets are served cache-immutable, the index
#                              no-cache. "/local" itself and unknown /local/* stay
#                              strict 404s.
#   GET  /local/state        — SSE stream of the ControllerSnapshot JSON: the same
#                              bytes publish_snapshot builds for the MQTT state topic
#                              (the script calls id(local_ui).push_snapshot, so the
#                              SSE cadence IS the snapshot cadence — even when the
#                              broker is down, which is the point of the local UI)
#   POST /local/command      — the MQTT command envelope, dispatched by the SAME body
#                              as the MQTT handler (installed below): same
#                              record_outcome, same publish_snapshot fast-path. The
#                              synchronous gate checks envelope + action only; the
#                              issued_at TTL is enforced by the dispatch body on the
#                              main loop (stale → recorded STALE via record_outcome).
#                              200 {"command_id":...} on accept, 400 {"error":...}
#                              otherwise; outcomes ride the snapshot.
#                              firmware_update is NOT exposed here — this endpoint is
#                              unauthenticated LAN HTTP, the MQTT lane is cert-pinned.
#   POST /local/automations  — raw automation wire blob (application/octet-stream):
#                              validated with the pure kernel, then applied via
#                              id(autos).apply_set on the main loop (persists to NVS).
#                              200 on APPLY_OK/APPLY_CLEARED, 400 otherwise.
#
# Both POSTs parse + gate synchronously on the httpd task (read-only) and marshal
# the mutation to the main loop via defer_to_loop() (Component::defer is protected)
# — the route engine, claims registry, and automation table are loop-thread only.
# =============================================================================

maji_local_ui:
  id: local_ui
  control_id: control
  autos_id: autos

esphome:
  on_boot:
    # Install the asset table + both POST handlers before the network comes up
    # (any on_boot priority beats the first HTTP request).
    - priority: 800
      then:
        - lambda: |-
${indent(bootBody, 12)}
`;
}

/** Minimal HTML-escape for the baked device name (it lands inside the page). */
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- Device-app dist reading ---------------------------------------------------
// The device-mode Angular build (npm run build:device → dist/device/browser) is
// read from disk ONLY under Node; codegen also runs inside the browser bundle
// (lazy editor/deploy chunk), where there is no fs — process.getBuiltinModule
// keeps the builtin out of the static import graph so the browser build never
// sees node:fs.

/** One dist file queued for embedding. */
interface DistAsset {
  servePath: string; // URL path in the table; the root index.html is "/"
  data: Uint8Array; // raw (pre-gzip) bytes
  contentType: string;
  immutable: boolean; // content-hashed filename → year-long cache header
}

const DEVICE_UI_DIST_ENV = 'DEVICE_UI_DIST';
/**
 * The device build's browser output (angular.json outputPath dist/device → the
 * application builder's browser/ subdir, where build-device.mjs also stamps the
 * marker), anchored at the repo root — the default must not resolve against the
 * process CWD or codegen run from another directory would silently embed the
 * placeholder. This file is src/lib/codegen/generators/local-ui.ts, so the root
 * is four levels up.
 */
const DEFAULT_DEVICE_UI_DIST = new URL('../../../../dist/device/browser', import.meta.url).pathname;
/** Stamped into the dist by scripts/build-device.mjs — proof this dir is a device build. */
const DEVICE_BUILD_MARKER = 'device-build.json';
/** Warn when the embedded payload passes this gzip total (ESP32 flash budget). */
const GZ_WARN_BYTES = 700 * 1024;

/** extension → MIME — keep in sync with content_type_for in maji_local_ui/core.cpp. */
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};

const contentTypeFor = (p: string) => CONTENT_TYPES[p.slice(p.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

/** Angular emits content-hashed names as `name-HASH.ext` (8 upper-alnum chars). */
const HASHED_NAME = /-[A-Z0-9]{8}\.[^/]+$/;

/** Serve paths are plain ASCII URL paths — anything else can't be matched over HTTP. */
const SERVABLE_PATH = /^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*)?$/;

/**
 * Read the device-app dist into embeddable assets, or null when it isn't there
 * (missing dir, missing/unparseable device-build.json marker, an unreadable
 * tree, or running in the browser bundle). Subdirectories are served at their
 * full path; the marker, *.map files, and the pre-rename index.csr.html are
 * skipped.
 */
// Structural minimums of node:fs/node:path — the app tsconfig has no node types,
// and a static node: import would leak into the browser bundle.
interface FsLike {
  existsSync(p: string): boolean;
  readdirSync(p: string, opts: { withFileTypes: true }): DirentLike[];
  readFileSync(p: string): Uint8Array;
}
interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface PathLike {
  resolve(...segments: string[]): string;
  join(...segments: string[]): string;
}

function readDeviceUiDist(): { dir: string; files: DistAsset[]; config?: string } | null {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; getBuiltinModule?: (m: string) => unknown } })
    .process;
  const fs = proc?.getBuiltinModule?.('node:fs') as FsLike | undefined;
  const path = proc?.getBuiltinModule?.('node:path') as PathLike | undefined;
  if (!fs || !path || !proc?.env) return null;
  // The env override is an explicit pointer, so CWD resolution is fine for it;
  // the default is anchored at the repo root (see DEFAULT_DEVICE_UI_DIST).
  const override = proc.env[DEVICE_UI_DIST_ENV];
  const dir = override ? path.resolve(override) : DEFAULT_DEVICE_UI_DIST;
  if (!fs.existsSync(dir)) return null;

  // The marker separates a device build from a cloud build / stale output in the
  // same dir — without it there is no telling WHICH app these files are, so fall
  // back to the placeholder rather than poison the flash image.
  let config: string | undefined;
  try {
    const marker: unknown = JSON.parse(new TextDecoder().decode(fs.readFileSync(path.join(dir, DEVICE_BUILD_MARKER))));
    if (typeof (marker as { config?: unknown }).config === 'string')
      config = (marker as { config: string }).config;
  } catch {
    console.warn(
      `local.ui: ${dir} has no readable ${DEVICE_BUILD_MARKER} — not a device build, embedding placeholder` +
        ' (run npm run build:device -- <config>)',
    );
    return null;
  }

  try {
    const files: DistAsset[] = [];
    const walk = (rel: string) => {
      const entries = fs
        .readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })
        // Bytewise, not localeCompare — the header must be identical on every machine.
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walk(r);
          continue;
        }
        if (!e.isFile()) continue;
        if (r === DEVICE_BUILD_MARKER) continue; // build provenance, not a servable asset
        if (r.endsWith('.map')) continue; // source maps never ship to the device
        if (r === 'index.csr.html') continue; // SSR artifact; build:device renames it to index.html
        // Service-worker files — device mode disables the SW; pure dead flash.
        if (r === 'ngsw-worker.js' || r === 'ngsw.json' || r === 'safety-worker.js' || r === 'worker-basic.min.js')
          continue;
        // Marketing/landing imagery belongs to the public site, not the dashboard —
        // it's the single largest dist entry and pure dead weight on the flash budget.
        if (r.startsWith('marketing/')) continue;
        // PWA install icons + SEO files — meaningless on a controller (no service
        // worker, no crawler); the dashboard never references them.
        if (r.startsWith('icons/')) continue;
        if (r === 'manifest.webmanifest' || r === 'robots.txt' || r === 'sitemap.xml') continue;
        // Self-hosted fonts (~200KB woff2): every font stack in styles.css ends in
        // system fallbacks (ui-sans-serif/system-ui, ui-monospace/Menlo), and
        // font-display:swap paints the fallback immediately on the 404 — the device
        // runs on system fonts, the cloud keeps the brand typefaces.
        if (r.startsWith('fonts/')) continue;
        const servePath = r === 'index.html' ? '/' : `/${r}`;
        if (!SERVABLE_PATH.test(servePath)) {
          console.warn(`local.ui: skipping ${r} — path can't be served by the flat asset table`);
          continue;
        }
        files.push({
          servePath,
          data: new Uint8Array(fs.readFileSync(path.join(dir, r))),
          contentType: contentTypeFor(r),
          immutable: HASHED_NAME.test(r),
        });
      }
    };
    walk('');
    return { dir, files, config };
  } catch (err) {
    // Permissions, a dir swapped mid-walk, … — a broken dist must not break the
    // whole bundle generation.
    console.warn(
      `local.ui: failed to read ${dir} (${err instanceof Error ? err.message : String(err)}), embedding placeholder` +
        ' (run npm run build:device -- <config>)',
    );
    return null;
  }
}

/** Placeholder page — embedded as the sole "/" entry when the dist is absent. */
function placeholderIndex(m: Manifest): Uint8Array {
  const name = escapeHtml(m.device.friendly_name);
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${name}</title>`,
    '<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:40rem}code{background:#eee;padding:0 .25rem}</style>',
    '</head><body>',
    `<h1>${name}</h1>`,
    '<p>The MajiFlow local operator UI will live here.</p>',
    '<p>Endpoints: <code>GET /local/state</code> (SSE snapshot stream),',
    '<code>POST /local/command</code>, <code>POST /local/automations</code>.</p>',
    '</body></html>',
  ].join('');
  return new TextEncoder().encode(html);
}

const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;

/**
 * C++ header — the app as a flat table of gzipped PROGMEM assets. Every dist file
 * becomes a static byte array; LOCAL_UI_ASSETS maps serve paths to them (the index
 * is the "/" entry). Missing dist → the placeholder page as the single "/" entry,
 * so codegen never requires an Angular build.
 */
export function generateLocalUiAssetsHeader(m: Manifest): string {
  const dist = readDeviceUiDist();
  let files: DistAsset[];
  let source: string;
  if (dist) {
    files = dist.files;
    // Name the baked site config (from the device-build.json marker) so a stale
    // or wrong-config build is visible in the bundle log.
    source = `${dist.dir} — device build of ${dist.config ?? '(unknown config)'}`;
    if (!files.some(f => f.servePath === '/'))
      console.warn(`local.ui: ${dist.dir} has no index.html — GET / will 404 (run npm run build:device -- <config>)`);
  } else {
    console.warn(
      'local.ui: device app dist not found, embedding placeholder — run npm run build:device -- <config> first',
    );
    files = [{ servePath: '/', data: placeholderIndex(m), contentType: 'text/html', immutable: false }];
    source = 'placeholder page (no dist)';
  }

  const arrays: string[] = [];
  const entries: string[] = [];
  let totalRaw = 0;
  let totalGz = 0;
  files.forEach((f, i) => {
    const gz = gzipSync(f.data);
    totalRaw += f.data.length;
    totalGz += gz.length;
    const bytes: string[] = [];
    for (let o = 0; o < gz.length; o += 12) {
      bytes.push(
        '  ' + Array.from(gz.subarray(o, o + 12), b => '0x' + b.toString(16).padStart(2, '0')).join(', ') + ',',
      );
    }
    arrays.push(`// ${f.servePath} (${f.data.length} B raw → ${gz.length} B gz)\nstatic const uint8_t LOCAL_UI_ASSET_${i}[] PROGMEM = {\n${bytes.join('\n')}\n};`);
    entries.push(
      `  {"${f.servePath}", LOCAL_UI_ASSET_${i}, sizeof(LOCAL_UI_ASSET_${i}), "${f.contentType}", ${f.immutable}},`,
    );
  });

  console.log(`local.ui: embedded ${files.length} asset(s), ${kb(totalRaw)} raw → ${kb(totalGz)} gz (${source})`);
  if (totalGz > GZ_WARN_BYTES)
    console.warn(`local.ui: embedded assets total ${kb(totalGz)} gz — above the 700KB flash budget warning line`);

  return `// =============================================================================
// MajiFlow — Local UI assets (local-ui-assets.h)
// =============================================================================
// AUTO-GENERATED. The device-mode operator app as a flat table of gzipped PROGMEM
// assets, served by the maji_local_ui component (routing rules in its core.h):
// exact path match → the file (Content-Encoding: gzip + the table Content-Type);
// "/" is the index, and "/index.html" / extension-less navigation GETs outside
// /local fall back to it (SPA deep-links); immutable entries (content-hashed
// names) are served with Cache-Control: max-age=31536000, immutable, everything
// else no-cache.
// Wired via id(local_ui).set_assets in local-ui.yaml.
// Source: ${source}
// Embedded: ${files.length} file(s), ${totalRaw} B raw → ${totalGz} B gz
// =============================================================================

#include "esphome/core/hal.h"  // PROGMEM (no-op on esp-idf — the blobs stay in flash rodata)
#include "esphome/components/maji_local_ui/core.h"  // maji_localui::LocalUiAsset

${arrays.join('\n\n')}

static const maji_localui::LocalUiAsset LOCAL_UI_ASSETS[] = {
${entries.join('\n')}
};
static const size_t LOCAL_UI_ASSETS_COUNT = sizeof(LOCAL_UI_ASSETS) / sizeof(LOCAL_UI_ASSETS[0]);
`;
}
