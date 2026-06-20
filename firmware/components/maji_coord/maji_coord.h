#pragma once
// Cross-controller coordination transport/codec. Owns the outbound counter, the
// anti-replay state, and the bound mirror sensors; encodes/decodes frames via the
// pure `maji_wire` codec. The claim registry is a SEPARATE component (maji_claims) —
// the two are wired together only by the generated `udp:` on_receive lambda, so
// neither references the other. Stock ESPHome `udp:` carries the bytes.
#include "esphome/core/component.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/binary_sensor/binary_sensor.h"
#include "wire.h"
#include <map>
#include <string>
#include <vector>

namespace esphome {
namespace maji_coord {

class MajiCoord : public Component {
 public:
  void set_self_id(const std::string &id) { self_id_ = id; }
  void set_udp_key(const std::string &key) { udp_key_ = key; }
  void set_confirm_timeout(uint32_t ms) { confirm_timeout_ms_ = ms; }
  void add_owned(const std::string &node) { owned_.push_back(node); }
  void add_imported_reading(const std::string &node, sensor::Sensor *s) { readings_[node] = s; }
  void add_imported_actuator(const std::string &node, binary_sensor::BinarySensor *s) { actuators_[node] = s; }

  void dump_config() override;
  // Confirmation liveness: an imported actuator's `cc_<node>` light flips false when no
  // `held` receipt has confirmed our claim within confirm_timeout_ms_ (owner silence).
  void loop() override;

  // True if `node` is a local actuator this controller owns (gates incoming claims).
  bool owns(const std::string &node) const;

  std::vector<uint8_t> encode_claim(const std::string &node) {
    return maji_wire::encode_claim(self_id_, udp_key_, send_ctr_, node);
  }
  std::vector<uint8_t> encode_release(const std::string &node) {
    return maji_wire::encode_release(self_id_, udp_key_, send_ctr_, node);
  }
  std::vector<uint8_t> encode_reading(const std::string &node, const std::string &role, float value) {
    return maji_wire::encode_reading(self_id_, udp_key_, send_ctr_, node, role, value);
  }
  std::vector<uint8_t> encode_held(const std::string &node, const std::string &who) {
    return maji_wire::encode_held(self_id_, udp_key_, send_ctr_, node, who);
  }

  // Parse + authenticate a received datagram. Fills `out` and returns true on accept.
  // Claims/releases for nodes we don't own are rejected here (parity with the old dispatcher).
  bool decode(const std::vector<uint8_t> &data, maji_wire::Frame &out);

  // Mirror-sensor publishers (sensor binding lives here, not in the pure codec).
  void publish_reading(const std::string &node, float value);
  void publish_held(const std::string &node, const std::string &who);

 protected:
  std::string self_id_;
  std::string udp_key_;
  uint32_t send_ctr_{0};
  std::map<std::string, uint32_t> seen_;
  std::vector<std::string> owned_;
  std::map<std::string, sensor::Sensor *> readings_;
  std::map<std::string, binary_sensor::BinarySensor *> actuators_;
  // Per-imported-actuator millis() of the last `held` receipt that confirmed our claim;
  // loop() flips the light false once this goes stale. 4 missed heartbeats by default.
  std::map<std::string, uint32_t> last_confirmed_ms_;
  uint32_t confirm_timeout_ms_{40000};
};

}  // namespace maji_coord
}  // namespace esphome
