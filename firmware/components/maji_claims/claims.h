#pragma once
// Remote-claim registry — the shared actuation-intent state between transport
// (UDP coordination + MQTT manual commands, the writers) and actuation (pump /
// valve control, the readers). An actuator runs while it has a live claim; claims
// expire on their lease and are pruned on read, so losing a writer stops the
// actuator within one tick. That positive model IS the local-mode control-loss
// fail-safe.
//
// CLAIM COMPOSITION. The registry holds a LIST of claims per actuator, so more than
// one controller can hold a live claim at once; the actuator runs while ANY claim is
// live (logical OR). Correct for a pump (on/off, legitimately shareable). For a valve
// the OR is correct per-valve but does NOT verify the combined open-set is a coherent
// flow path — a design-time topology property, not enforced here.
#include "esphome/core/component.h"
#include "esphome/components/number/number.h"
#include <map>
#include <vector>
#include <string>

namespace esphome {
namespace maji_claims {

// One controller's live claim on an actuator, with its lease expiry (millis() clock).
struct Claim {
  std::string owner;
  uint32_t expires_at;
};

class MajiClaims : public Component {
 public:
  void set_lease_number(number::Number *n) { lease_number_ = n; }
  void add_valve(const std::string &id) { valves_.push_back(id); }

  void dump_config() override;

  // Add or refresh `owner`'s claim on `node` (lease from the bound claim_lease_s).
  void extend(const std::string &node, const std::string &owner);
  // Remove `owner`'s claim on `node`.
  void drop(const std::string &node, const std::string &owner);
  // True if any live claim remains on `node` (prunes expired first).
  bool has_live_claim(const std::string &node);
  // Sorted, comma-joined owners of live claims on `node` ("" = none) — the held receipt.
  std::string claimants_csv(const std::string &node);

  bool is_valve_node(const std::string &node) const;
  std::string valve_id_for_index(int idx) const;
  int valve_count() const { return (int) valves_.size(); }

 protected:
  uint32_t lease_ms_();
  void prune_(const std::string &node);

  number::Number *lease_number_{nullptr};
  std::vector<std::string> valves_;
  std::map<std::string, std::vector<Claim>> registry_;
};

}  // namespace maji_claims
}  // namespace esphome
