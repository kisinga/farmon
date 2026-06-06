import type { Manifest } from '@core';
import { localNodesWithFlag } from '@core';

/**
 * Generate the C++ remote-claim registry for cross-controller actuation (local
 * mode). A peer controller publishes a timed `node_claim` over the peer lane;
 * the owner records it here and runs the actuator while the claim is alive:
 *
 *   - pumps / vfd → `has_live_claim(id)` in control.ts pumpMgmt drives the relay.
 *   - valves      → `has_live_claim(id)` in routes.ts reconcile_valves opens it.
 *
 * A claim carries a lease (the owner's tunable `claim_lease_s`); the importer
 * re-claims on a heartbeat. Stop renewing (peer link lost) → the claim expires →
 * `prune_expired_claims` drops it → the next tick stops the pump / closes the
 * valve. That positive model IS the local-mode control-loss fail-safe; there is
 * no separate negative "enforce" pass (local routes drive actuators directly via
 * pump_ref_count / slot valve masks, never through this registry).
 */
export function generateDeadman(m: Manifest): string {
  const valves = localNodesWithFlag(m, 'isValve');

  // Build valve ID lookup table for index → nodeId mapping (used by
  // reconcile_valves to fold remote claims into the desired-open mask).
  const valveIdArray = valves.map(v => `    "${v.id}"`).join(",\n");

  return `\
// =============================================================================
// Anchor Mesh — Remote-Claim Registry
// =============================================================================
// Tracks timed claims a peer controller places on this controller's actuators.
// An actuator runs while it has a live claim; claims expire on their lease and
// are pruned, so losing the peer link stops the actuator within one tick.
// =============================================================================

#include <map>
#include <vector>
#include <string>
#include <algorithm>

struct Claim {
  std::string owner;
  uint32_t expires_at;
};

static std::map<std::string, std::vector<Claim>> claim_registry;

${valves.length > 0 ? `static const char* VALVE_IDS[${valves.length}] = {
${valveIdArray}
};` : "// No valves in this controller's manifest"}

inline uint32_t get_claim_lease_ms() {
  float v = id(claim_lease_s).state;
  return (!std::isnan(v) && v >= 30.0f) ? (uint32_t)(v * 1000.0f) : 90000U;
}

inline void extend_deadman(const std::string& nodeId, const std::string& owner, uint32_t /*durationMs*/) {
  uint32_t leaseMs = get_claim_lease_ms();
  auto& claims = claim_registry[nodeId];
  auto it = std::find_if(claims.begin(), claims.end(), [&](const Claim& c) { return c.owner == owner; });
  uint32_t now = millis();
  if (it != claims.end()) {
    it->expires_at = now + leaseMs;
  } else {
    claims.push_back({owner, now + leaseMs});
  }
}

inline void drop_claim(const std::string& nodeId, const std::string& owner) {
  auto it = claim_registry.find(nodeId);
  if (it == claim_registry.end()) return;
  auto& claims = it->second;
  claims.erase(std::remove_if(claims.begin(), claims.end(), [&](const Claim& c) { return c.owner == owner; }), claims.end());
  if (claims.empty()) claim_registry.erase(it);
}

inline void prune_expired_claims(const std::string& nodeId) {
  auto it = claim_registry.find(nodeId);
  if (it == claim_registry.end()) return;
  auto& claims = it->second;
  uint32_t now = millis();
  claims.erase(std::remove_if(claims.begin(), claims.end(), [&](const Claim& c) {
    return now >= c.expires_at;
  }), claims.end());
  if (claims.empty()) claim_registry.erase(it);
}

inline bool has_live_claim(const std::string& nodeId) {
  prune_expired_claims(nodeId);
  auto it = claim_registry.find(nodeId);
  if (it == claim_registry.end()) return false;
  return !it->second.empty();
}

inline std::string valve_id_for_index(int idx) {
  ${valves.length > 0 ? `if (idx < 0 || idx >= ${valves.length}) return "";
  return VALVE_IDS[idx];` : `return "";`}
}

// True if nodeId is a local valve — lets the manual handler open it via a claim.
inline bool is_valve_node(const char* nodeId) {
${valves.length > 0 ? `  for (int i = 0; i < ${valves.length}; i++) if (strcmp(nodeId, VALVE_IDS[i]) == 0) return true;
  return false;` : `  return false;`}
}
`;
}
