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
 *                          the command/automations handlers (they need id() access, so
 *                          they are generated here, not baked into the component).
 *   - local-ui-assets.h  — the gzipped single-page app as a PROGMEM blob. PLACEHOLDER
 *                          for now: a tiny page naming the device; the real bundle is
 *                          swapped in later by regenerating this header (the component
 *                          only reads the LOCAL_UI_INDEX_GZ symbol).
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
    '  id(local_ui).defer([body]() {',
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
    '  id(local_ui).defer([blob]() { id(autos).apply_set((const uint8_t *) blob.data(), blob.size()); });',
    '  return 200;',
    '});',
  ];
  const bootBody = [
    'id(local_ui).set_index_asset(LOCAL_UI_INDEX_GZ, LOCAL_UI_INDEX_GZ_LEN);',
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
#   GET  /                   — the gzipped single-page app (local-ui-assets.h)
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
# the mutation to the main loop via defer() — the route engine, claims registry,
# and automation table are loop-thread only.
# =============================================================================

maji_local_ui:
  id: local_ui
  control_id: control
  autos_id: autos

esphome:
  on_boot:
    # Install the asset pointer + both POST handlers before the network comes up
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

/** C++ header — the gzipped app bundle as a PROGMEM blob (PLACEHOLDER page for now). */
export function generateLocalUiAssetsHeader(m: Manifest): string {
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
  const gz = gzipSync(new TextEncoder().encode(html));
  const bytes: string[] = [];
  for (let i = 0; i < gz.length; i += 12) {
    bytes.push(
      '  ' + Array.from(gz.subarray(i, i + 12), b => '0x' + b.toString(16).padStart(2, '0')).join(', ') + ',',
    );
  }

  return `// =============================================================================
// MajiFlow — Local UI assets (local-ui-assets.h)
// =============================================================================
// AUTO-GENERATED. The gzipped single-page app the maji_local_ui component serves at
// GET / (Content-Encoding: gzip), served straight from flash. PLACEHOLDER bundle —
// the real operator dashboard is swapped in by regenerating this header; the
// component only reads the LOCAL_UI_INDEX_GZ / LOCAL_UI_INDEX_GZ_LEN symbols (wired
// via id(local_ui).set_index_asset in local-ui.yaml).
// =============================================================================

#include "esphome/core/hal.h"  // PROGMEM (no-op on esp-idf — the blob stays in flash rodata)

static const uint8_t LOCAL_UI_INDEX_GZ[] PROGMEM = {
${bytes.join('\n')}
};
static const size_t LOCAL_UI_INDEX_GZ_LEN = sizeof(LOCAL_UI_INDEX_GZ);
`;
}
