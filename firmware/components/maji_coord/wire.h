#pragma once
// Cross-controller wire codec — HMAC authentication, canonical signing, frame
// encode, and verify + anti-replay. PURE: depends only on mbedtls + the standard
// library (no ESPHome), so it host-compiles for tests and ports unchanged to a
// fork / full-custom firmware. The wire format is JSON over LAN UDP broadcast;
// authenticity (not secrecy) comes from an HMAC-SHA256 tag over the per-site key.
#include <cstdint>
#include <map>
#include <string>
#include <vector>
#include <cmath>

namespace maji_wire {

// A decoded, authenticated message. `role`/`value` are set for readings; `who` for held.
struct Frame {
  std::string type;
  std::string node;
  std::string from;
  std::string role;
  float value{NAN};
  std::string who;
};

// HMAC-SHA256(key, msg) truncated to a 64-bit hex tag (16 chars). "" on failure.
std::string hmac(const std::string &key, const std::string &msg);

// Canonical signed string: type|node|from|counter[|extra]. Both ends build it the
// same way so the tag matches; reading `extra` is "role|%.4f-value", held is `who`.
std::string sig(const char *t, const std::string &node, const std::string &from, uint32_t c,
                const std::string &extra);

// Build + sign an outbound datagram. `ctr` is the sender's monotonic counter,
// incremented in place. importer -> owner: claim keeps a node active, release relinquishes.
std::vector<uint8_t> encode_claim(const std::string &self, const std::string &key, uint32_t &ctr,
                                  const std::string &node);
std::vector<uint8_t> encode_release(const std::string &self, const std::string &key, uint32_t &ctr,
                                    const std::string &node);
// owner -> importers: a sensor reading.
std::vector<uint8_t> encode_reading(const std::string &self, const std::string &key, uint32_t &ctr,
                                    const std::string &node, const std::string &role, float value);
// owner -> importers: the live-claimant set for an owned actuator (the receipt).
std::vector<uint8_t> encode_held(const std::string &self, const std::string &key, uint32_t &ctr,
                                 const std::string &node, const std::string &who);

// Accept once: HMAC valid AND counter advanced. A large backward jump (last - c > 4096)
// means the sender rebooted (RAM counter reset) — accept and re-baseline. Rejects forgery,
// replay, and our own echo. Updates `seen[from]` on accept. `extra` must match the type as
// in sig() above so the recomputed tag matches the sender's.
bool verify(const std::string &key, const std::string &self, const std::string &from, uint32_t c,
            const char *t, const std::string &node, const std::string &extra, const std::string &mac,
            std::map<std::string, uint32_t> &seen);

// Confirmation liveness: true if an imported actuator last confirmed at `last_ms` (the
// owner's `held` receipt that listed us) is now stale — no fresh confirmation within
// `timeout_ms`. last_ms == 0 (never confirmed) is stale. Wraparound-safe unsigned
// subtraction. Pure so the importer's `cc_<node>` light goes false on owner silence
// instead of staying stuck on its last receipt; host-tested with the codec.
inline bool confirm_stale(uint32_t last_ms, uint32_t now_ms, uint32_t timeout_ms) {
  if (last_ms == 0)
    return true;
  return (uint32_t) (now_ms - last_ms) >= timeout_ms;
}

}  // namespace maji_wire
