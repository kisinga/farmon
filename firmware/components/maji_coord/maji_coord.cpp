#include "maji_coord.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/json/json_util.h"
#include <cmath>
#include <cstdio>
#include <cstring>

namespace esphome {
namespace maji_coord {

static const char *const TAG = "maji_coord";

bool MajiCoord::owns(const std::string &node) const {
  for (auto &o : owned_)
    if (o == node)
      return true;
  return false;
}

bool MajiCoord::decode(const std::vector<uint8_t> &data, maji_wire::Frame &out) {
  bool accepted = false;
  json::parse_json(data.data(), data.size(), [&](JsonObject x) -> bool {
    const char *t = x["t"] | "";
    const char *node = x["node_id"] | "";
    const char *from = x["from"] | "";
    uint32_t c = (uint32_t) (x["c"] | 0);
    const char *mac = x["mac"] | "";
    if (t[0] == 0 || node[0] == 0 || from[0] == 0)
      return false;

    // Reconstruct the type-specific `extra` exactly as the sender signed it so the
    // recomputed HMAC matches. claim/release sign over no extra and are gated on
    // ownership before verifying (skip the HMAC for actuators that aren't ours).
    std::string extra;
    std::string role;
    float value = NAN;
    std::string who;
    if (strcmp(t, "claim") == 0 || strcmp(t, "release") == 0) {
      if (!this->owns(node))
        return false;
    } else if (strcmp(t, "reading") == 0) {
      role = x["role"] | "";
      value = x["value"] | NAN;
      char vbuf[24];
      snprintf(vbuf, sizeof(vbuf), "%.4f", value);
      extra = role + "|" + vbuf;
    } else if (strcmp(t, "held") == 0) {
      who = x["who"] | "";
      extra = who;
    } else {
      return false;  // unknown type
    }

    if (!maji_wire::verify(this->udp_key_, this->self_id_, from, c, t, node, extra, mac, this->seen_))
      return false;

    out.type = t;
    out.node = node;
    out.from = from;
    out.role = role;
    out.value = value;
    out.who = who;
    accepted = true;
    return true;
  });
  return accepted;
}

void MajiCoord::publish_reading(const std::string &node, float value) {
  auto it = readings_.find(node);
  if (it != readings_.end())
    it->second->publish_state(value);
}

void MajiCoord::publish_held(const std::string &node, const std::string &who) {
  // `mine` = this controller is in the owner's claimant set (our claim landed).
  bool mine = false;
  size_t pos = 0;
  while (true) {
    size_t comma = who.find(',', pos);
    std::string tok = who.substr(pos, comma == std::string::npos ? std::string::npos : comma - pos);
    if (tok == self_id_) {
      mine = true;
      break;
    }
    if (comma == std::string::npos)
      break;
    pos = comma + 1;
  }
  // Stamp the confirmation clock so loop() can time it out on owner silence; a `held`
  // that no longer lists us (mine=false, e.g. after a release) flips the light off now.
  if (mine)
    last_confirmed_ms_[node] = millis();
  auto it = actuators_.find(node);
  if (it != actuators_.end())
    it->second->publish_state(mine);
}

// A confirmed `cc_<node>` light is only trustworthy while `held` receipts keep arriving;
// if the owner goes silent (offline / partition / crash) no receipt ever flips it false.
// Time it out here so a stuck-green light can't hide a claim that stopped landing.
void MajiCoord::loop() {
  uint32_t now = millis();
  for (auto &kv : actuators_) {
    if (!kv.second->state)
      continue;  // only a currently-confirmed light can go stale
    auto it = last_confirmed_ms_.find(kv.first);
    uint32_t last = (it != last_confirmed_ms_.end()) ? it->second : 0;
    if (maji_wire::confirm_stale(last, now, confirm_timeout_ms_))
      kv.second->publish_state(false);
  }
}

void MajiCoord::dump_config() {
  ESP_LOGCONFIG(TAG, "MajiCoord: self=%s, %d owned, %d reading(s), %d actuator(s)", self_id_.c_str(),
                (int) owned_.size(), (int) readings_.size(), (int) actuators_.size());
}

}  // namespace maji_coord
}  // namespace esphome
