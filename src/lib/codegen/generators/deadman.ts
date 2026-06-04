import type { Manifest } from '@core';
import { localNodesWithFlag, NODE_REGISTRY } from '@core';

/**
 * Generate the C++ dead-man module for actuator claim tracking.
 *
 * This module maintains a registry of claims per actuator node.
 * Local route slots set "local" claims. Remote controllers set timed claims.
 * An actuator runs if ANY claim is alive.
 *
 * Safety-critical actuators (pump, vfd, dosing_pump) use deadManAction: 'stop'.
 * Valves default to deadManAction: 'hold'.
 */
export function generateDeadman(m: Manifest): string {
  const valves = localNodesWithFlag(m, 'isValve');
  const pumps = localNodesWithFlag(m, 'isPump');
  const dosingPumps = localNodesWithFlag(m, 'isDosingPump');
  const actuators = [...valves, ...pumps, ...dosingPumps];

  // Build valve ID lookup table for index → nodeId mapping
  const valveIdArray = valves.map(v => `    "${v.id}"`).join(",\n");

  // Per-actuator dead-man timeout and action constants
  const timeoutCases = actuators.map(n => {
    const desc = NODE_REGISTRY.get(n.kind);
    const sp = desc?.safetyProfile;
    const timeout = sp?.deadManTimeoutMs ?? 0;
    const action = sp?.deadManAction ?? 'hold';
    return `    {"${n.id}", {${timeout}, '${action.charAt(0)}'}},  // ${n.name ?? n.id}`;
  }).join("\n");

  return `\
// =============================================================================
// Anchor Mesh — Dead-Man Claim Registry
// =============================================================================
// Tracks local and remote claims per actuator. An actuator runs if ANY claim
// is alive. Claims are automatically ejected when they expire.
// =============================================================================

#include <map>
#include <vector>
#include <string>
#include <algorithm>

struct Claim {
  std::string owner;
  uint32_t expires_at;
  bool local;
};

struct ActuatorProfile {
  uint32_t timeout_ms;
  char action;  // 's'=stop, 'h'=hold, 'r'=revert
};

static std::map<std::string, std::vector<Claim>> claim_registry;
static std::map<std::string, ActuatorProfile> actuator_profiles = {
${timeoutCases}
};

${valves.length > 0 ? `static const char* VALVE_IDS[${valves.length}] = {
${valveIdArray}
};` : "// No valves in this controller's manifest"}

inline uint32_t get_claim_lease_ms() {
  float v = id(claim_lease_s).state;
  return (!std::isnan(v) && v >= 30.0f) ? (uint32_t)(v * 1000.0f) : 90000U;
}

inline void extend_deadman(const std::string& nodeId, const std::string& owner, uint32_t /*durationMs*/, bool local = false) {
  uint32_t leaseMs = get_claim_lease_ms();
  auto& claims = claim_registry[nodeId];
  auto it = std::find_if(claims.begin(), claims.end(), [&](const Claim& c) { return c.owner == owner; });
  uint32_t now = millis();
  if (it != claims.end()) {
    it->expires_at = now + leaseMs;
    it->local = local;
  } else {
    claims.push_back({owner, now + leaseMs, local});
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
    return !c.local && now >= c.expires_at;
  }), claims.end());
  if (claims.empty()) claim_registry.erase(it);
}

inline bool has_live_claim(const std::string& nodeId) {
  prune_expired_claims(nodeId);
  auto it = claim_registry.find(nodeId);
  if (it == claim_registry.end()) return false;
  return !it->second.empty();
}

inline bool has_live_local_claim(const std::string& nodeId) {
  prune_expired_claims(nodeId);
  auto it = claim_registry.find(nodeId);
  if (it == claim_registry.end()) return false;
  for (const auto& c : it->second) {
    if (c.local) return true;
  }
  return false;
}

inline std::string valve_id_for_index(int idx) {
  ${valves.length > 0 ? `if (idx < 0 || idx >= ${valves.length}) return "";
  return VALVE_IDS[idx];` : `return "";`}
}

inline void stop_actuator(const std::string& nodeId);

inline void enforce_deadman(const std::string& nodeId) {
  prune_expired_claims(nodeId);
  auto it = claim_registry.find(nodeId);
  if (it != claim_registry.end() && !it->second.empty()) return;
  // No live claims — enforce dead-man action
  auto profileIt = actuator_profiles.find(nodeId);
  if (profileIt == actuator_profiles.end()) return;
  char action = profileIt->second.action;
  if (action == 's' || action == 'r') {
    stop_actuator(nodeId);
  }
  // 'h' (hold) — do nothing, leave actuator in current state
}
`;
}
