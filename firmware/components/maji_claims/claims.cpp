#include "claims.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include <algorithm>
#include <cmath>

namespace esphome {
namespace maji_claims {

static const char *const TAG = "maji_claims";

// Lease is operator-tunable (claim_lease_s, 30..600s); fall back to 90s if the entity
// is unset/invalid. Read live every extend so a runtime change takes effect immediately.
uint32_t MajiClaims::lease_ms_() {
  float v = lease_number_ != nullptr ? lease_number_->state : NAN;
  return (!std::isnan(v) && v >= 30.0f) ? (uint32_t) (v * 1000.0f) : 90000U;
}

void MajiClaims::extend(const std::string &node, const std::string &owner) {
  uint32_t lease = lease_ms_();
  auto &claims = registry_[node];
  uint32_t now = millis();
  auto it = std::find_if(claims.begin(), claims.end(), [&](const Claim &c) { return c.owner == owner; });
  if (it != claims.end())
    it->expires_at = now + lease;
  else
    claims.push_back({owner, now + lease});
}

void MajiClaims::drop(const std::string &node, const std::string &owner) {
  auto it = registry_.find(node);
  if (it == registry_.end())
    return;
  auto &claims = it->second;
  claims.erase(std::remove_if(claims.begin(), claims.end(), [&](const Claim &c) { return c.owner == owner; }),
               claims.end());
  if (claims.empty())
    registry_.erase(it);
}

void MajiClaims::prune_(const std::string &node) {
  auto it = registry_.find(node);
  if (it == registry_.end())
    return;
  auto &claims = it->second;
  uint32_t now = millis();
  claims.erase(std::remove_if(claims.begin(), claims.end(), [&](const Claim &c) { return now >= c.expires_at; }),
               claims.end());
  if (claims.empty())
    registry_.erase(it);
}

bool MajiClaims::has_live_claim(const std::string &node) {
  prune_(node);
  auto it = registry_.find(node);
  return it != registry_.end() && !it->second.empty();
}

std::string MajiClaims::claimants_csv(const std::string &node) {
  prune_(node);
  auto it = registry_.find(node);
  if (it == registry_.end())
    return "";
  std::vector<std::string> who;
  for (auto &c : it->second)
    who.push_back(c.owner);
  std::sort(who.begin(), who.end());
  std::string out;
  for (size_t i = 0; i < who.size(); i++) {
    if (i)
      out += ',';
    out += who[i];
  }
  return out;
}

bool MajiClaims::is_valve_node(const std::string &node) const {
  for (auto &v : valves_)
    if (v == node)
      return true;
  return false;
}

std::string MajiClaims::valve_id_for_index(int idx) const {
  if (idx < 0 || idx >= (int) valves_.size())
    return "";
  return valves_[idx];
}

void MajiClaims::dump_config() { ESP_LOGCONFIG(TAG, "MajiClaims: %d valve(s)", (int) valves_.size()); }

}  // namespace maji_claims
}  // namespace esphome
