import type { Manifest } from '@core';
import { localNodesWithFlag, collectTelemetryChannels } from '@core';
import type { GenerationMetadata } from '../backends/types';

/**
 * Cross-controller coordination over UDP.
 *
 * Controller↔controller traffic — actuator claims AND remote sensor reads — rides
 * ESPHome's `udp:` component (LAN broadcast, udp.write/on_receive), authenticated
 * with HMAC-SHA256 over the per-site `udp_key` (authenticity, not secrecy).
 *
 * The owner is generic and reactive: `on_receive` acts on a claim from any sender
 * for a node this controller owns, keyed by `from` (the sender id, in the payload —
 * on_receive does not expose the packet source). Adding a claimant flashes only the
 * new controller. Claims feed the dead-man registry (deadman.ts); the lease is the
 * fail-safe (stop renewing → lease expires → actuator stops).
 *
 * Emitted on every device:
 *   - coordination.h    — C++ HMAC + message build/parse + the generic dispatcher.
 *   - coordination.yaml — the `udp:` block (on_receive → dispatcher), the `udp_key`
 *     global, and the owner's reading-broadcast interval.
 */

/** ESPHome `udp:` listen/broadcast port (component default; pinned for clarity). */
const UDP_PORT = 18511;
/** Re-broadcast / re-claim cadence; well under the 90s dead-man lease. */
const HEARTBEAT_MS = 10000;
/** Roles an importer mirrors as a local `ri_<node>` sensor (the read-import). */
const READING_ROLES = ['level', 'flow'] as const;

/** Local actuator node ids — a claim is honoured only for these (owner side). */
function ownedActuatorIds(m: Manifest): string[] {
  const ids = new Set<string>();
  for (const flag of ['isPump', 'isValve', 'isDosingPump'] as const) {
    for (const n of localNodesWithFlag(m, flag)) ids.add(n.id);
  }
  return [...ids];
}

/** Imported sensor node ids this controller mirrors as `ri_<id>` (importer side). */
function importedReadingIds(m: Manifest): string[] {
  return m.imports
    .filter((n) => n.kind === 'tank' || n.kind === 'flow_sensor')
    .map((n) => n.id);
}

/** Local readable channels (level/flow) this controller broadcasts for importers. */
function ownedReadingChannels(m: Manifest) {
  return collectTelemetryChannels(m).filter(
    (c) => c.node && c.role && (READING_ROLES as readonly string[]).includes(c.role),
  );
}

/**
 * C++ header: HMAC auth, message builders, and the generic on_receive dispatcher.
 * Included AFTER routes.h (it calls `extend_deadman`/`drop_claim` from there).
 */
export function generateCoordinationHeader(m: Manifest, metadata: GenerationMetadata): string {
  const self = metadata.controllerId;
  const owned = ownedActuatorIds(m);
  const reads = importedReadingIds(m);

  const ownsFn = owned.length > 0
    ? `static const char* COORD_OWNED[] = {${owned.map((id) => `"${id}"`).join(', ')}};
inline bool coord_owns(const char* node) {
  for (auto* o : COORD_OWNED) if (strcmp(node, o) == 0) return true;
  return false;
}`
    : `inline bool coord_owns(const char*) { return false; }  // owns no actuators`;

  // Reading dispatch: node id → the local mirror sensor it populates.
  const readingDispatch = reads.length > 0
    ? reads.map((id) => `      if (strcmp(node, "${id}") == 0) { id(ri_${id}).publish_state(value); return true; }`).join('\n')
    : '      // no imported readings';

  return `// =============================================================================
// MajiFlow — Cross-Controller Coordination over UDP (coordination.h)
// =============================================================================
// Controller<->controller coordination (actuator claims + remote sensor reads),
// LAN UDP broadcast, authenticated with HMAC-SHA256 over the per-site udp_key.
// on_receive hands us the raw bytes; the sender is not exposed, so the claimant
// id travels in 'from'. The dispatcher is generic: it acts on a claim from any
// sender for a node this controller owns.
// =============================================================================

#include <map>
#include <string>
#include <vector>
#include <cmath>
#include "mbedtls/md.h"
#include "esphome/components/json/json_util.h"

// This controller's id — the 'from' on every outbound message.
static const char* COORD_SELF = "${self}";

// Outbound monotonic counter (RAM; resets on reboot — see anti-replay note below).
static uint32_t coord_send_ctr = 0;
// Highest counter accepted per sender (anti-replay).
static std::map<std::string, uint32_t> coord_seen;

${ownsFn}

// HMAC-SHA256(udp_key, msg), truncated to a 64-bit hex tag. Authenticity, not
// secrecy: a LAN attacker without the key cannot forge a claim/reading.
inline std::string coord_hmac(const std::string& msg) {
  const std::string& key = id(udp_key_g);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == nullptr) return "";
  uint8_t mac[32];
  if (mbedtls_md_hmac(info, (const uint8_t*) key.data(), key.size(),
                      (const uint8_t*) msg.data(), msg.size(), mac) != 0) return "";
  static const char HX[] = "0123456789abcdef";
  std::string out; out.reserve(16);
  for (int i = 0; i < 8; i++) { out += HX[mac[i] >> 4]; out += HX[mac[i] & 0x0F]; }
  return out;
}

// Canonical signed string: type|node|from|counter[|extra]. Both ends build it the
// same way so the tag matches; reading 'extra' is "role|%.4f-value".
inline std::string coord_sig(const char* t, const char* node, const char* from, uint32_t c, const std::string& extra) {
  std::string s; s.reserve(96);
  s += t; s += '|'; s += node; s += '|'; s += from; s += '|'; s += std::to_string(c);
  if (!extra.empty()) { s += '|'; s += extra; }
  return s;
}

inline std::vector<uint8_t> coord_bytes(const std::string& s) {
  return std::vector<uint8_t>(s.begin(), s.end());
}

// importer -> owner: keep node active / relinquish it.
inline std::vector<uint8_t> build_claim_msg(const char* node) {
  uint32_t c = ++coord_send_ctr;
  std::string mac = coord_hmac(coord_sig("claim", node, COORD_SELF, c, ""));
  std::string j = std::string("{\\"t\\":\\"claim\\",\\"node_id\\":\\"") + node +
    "\\",\\"from\\":\\"" + COORD_SELF + "\\",\\"c\\":" + std::to_string(c) + ",\\"mac\\":\\"" + mac + "\\"}";
  return coord_bytes(j);
}
inline std::vector<uint8_t> build_release_msg(const char* node) {
  uint32_t c = ++coord_send_ctr;
  std::string mac = coord_hmac(coord_sig("release", node, COORD_SELF, c, ""));
  std::string j = std::string("{\\"t\\":\\"release\\",\\"node_id\\":\\"") + node +
    "\\",\\"from\\":\\"" + COORD_SELF + "\\",\\"c\\":" + std::to_string(c) + ",\\"mac\\":\\"" + mac + "\\"}";
  return coord_bytes(j);
}
// owner -> importer: a sensor reading (importers filter by node id).
inline std::vector<uint8_t> build_reading_msg(const char* node, const char* role, float value) {
  uint32_t c = ++coord_send_ctr;
  char vbuf[24]; snprintf(vbuf, sizeof(vbuf), "%.4f", value);
  std::string mac = coord_hmac(coord_sig("reading", node, COORD_SELF, c, std::string(role) + "|" + vbuf));
  std::string j = std::string("{\\"t\\":\\"reading\\",\\"node_id\\":\\"") + node +
    "\\",\\"from\\":\\"" + COORD_SELF + "\\",\\"c\\":" + std::to_string(c) +
    ",\\"role\\":\\"" + role + "\\",\\"value\\":" + vbuf + ",\\"mac\\":\\"" + mac + "\\"}";
  return coord_bytes(j);
}

// Accept once: HMAC valid AND counter advanced. A large backward jump means the
// sender rebooted (RAM counter reset) — accept and re-baseline. This blocks naive
// continuous replay; forgery is fully blocked by the HMAC. Stronger (flash-persisted)
// replay protection is deferred — claims are not secret and the 90s lease bounds any
// replayed claim to one lease of an intent the importer recently held.
inline bool coord_accept(const char* from, uint32_t c, const char* t, const char* node, const std::string& extra, const char* mac) {
  if (from[0] == 0 || strcmp(from, COORD_SELF) == 0) return false;
  std::string want = coord_hmac(coord_sig(t, node, from, c, extra));
  if (want.empty() || want != mac) return false;
  std::string key(from);
  auto it = coord_seen.find(key);
  if (it != coord_seen.end()) {
    uint32_t last = it->second;
    if (!(c > last || last - c > 4096u)) return false;  // replay
  }
  coord_seen[key] = c;
  return true;
}

// Generic dispatcher — called by the udp: on_receive trigger with the raw bytes.
inline void handle_coord_msg(const std::vector<uint8_t>& data) {
  esphome::json::parse_json(data.data(), data.size(), [](JsonObject x) -> bool {
    const char* t = x["t"] | "";
    const char* node = x["node_id"] | "";
    const char* from = x["from"] | "";
    uint32_t c = (uint32_t)(x["c"] | 0);
    const char* mac = x["mac"] | "";
    if (t[0] == 0 || node[0] == 0 || from[0] == 0) return false;

    if (strcmp(t, "claim") == 0 || strcmp(t, "release") == 0) {
      if (!coord_owns(node)) return false;              // not our actuator — ignore
      if (!coord_accept(from, c, t, node, "", mac)) return false;
      if (t[0] == 'c') extend_deadman(node, from, 0);   // claim
      else drop_claim(node, from);                      // release
      return true;
    }
    if (strcmp(t, "reading") == 0) {
      const char* role = x["role"] | "";
      float value = x["value"] | NAN;
      char vbuf[24]; snprintf(vbuf, sizeof(vbuf), "%.4f", value);
      if (!coord_accept(from, c, "reading", node, std::string(role) + "|" + vbuf, mac)) return false;
${readingDispatch}
      return true;
    }
    return false;
  });
}
`;
}

/**
 * YAML package: the single `udp:` component (on_receive → dispatcher), the
 * `udp_key` global (from the `udp_key` substitution = `!secret udp_key`), and the
 * owner's reading-broadcast interval. Always emitted; harmless on an island
 * controller (it just listens and broadcasts its own readings to nobody).
 */
export function generateCoordination(m: Manifest): string {
  const readings = ownedReadingChannels(m);

  // Owner: broadcast each local reading via the udp.write action (which enables the
  // component's broadcast socket); importers filter by node id. Guarded so a not-yet-read
  // (NaN) sensor is skipped.
  const readingInterval = readings.length > 0
    ? `
interval:
  - interval: ${HEARTBEAT_MS}ms
    then:
${readings.map((c) => `      - if:
          condition:
            lambda: 'return !std::isnan(id(${c.ref}).state);'
          then:
            - udp.write:
                id: coord_udp
                data: !lambda |-
                  return build_reading_msg("${c.node}", "${c.role}", id(${c.ref}).state);`).join('\n')}
`
    : '';

  return `# =============================================================================
# MajiFlow — Cross-Controller Coordination (UDP)
# =============================================================================
# AUTO-GENERATED. MQTT is the device<->server pipe; this is the ONLY
# controller<->controller lane (claims + remote sensor reads), HMAC-authenticated
# over the per-site udp_key. The C++ lives in packages/coordination.h.
# =============================================================================

globals:
  - id: udp_key_g
    type: std::string
    restore_value: no
    initial_value: '"\${udp_key}"'

udp:
  id: coord_udp
  port: ${UDP_PORT}
  on_receive:
    - lambda: |-
        handle_coord_msg(data);
${readingInterval}`;
}
