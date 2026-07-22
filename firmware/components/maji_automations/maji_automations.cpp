#include "maji_automations.h"
#include "esphome/core/log.h"
#include <cmath>
#include <cstring>
#include <memory>

namespace esphome {
namespace maji_automations {

static const char *const TAG = "auto";

// --- Fixed POD on-flash form of the last-good automation set -------------------------
// The raw validated wire blob, length-tagged. ESPHome's ESPPreferenceObject stores any
// POD as a single NVS blob (same idiom as MeterBlob in maji_control), and ~1.2 KB is
// comfortably inside NVS blob limits on ESP-IDF — so we use make_preference<POD>
// instead of dropping to raw esp-idf nvs calls.
static constexpr uint32_t AUTOS_BLOB_KEY = 0x41555453;  // "AUTS" — preferences hash
struct AutosBlob {
  uint32_t magic;
  uint16_t len;
  uint8_t data[maji_auto::MAX_AUTOMATION_SET_BYTES];
};

// Map an automation's sparse run-param override into the control engine's StopSpec.
static maji_ctl::StopSpec automation_stopspec(const maji_auto::RuntimeAutomation &a) {
  maji_ctl::StopSpec s;
  s.override_mask = a.override_mask;
  s.ov_source_min_pct = a.ov_source_min_pct;
  s.ov_dest_max_pct = a.ov_dest_max_pct;
  s.ov_max_runtime_min = a.ov_max_runtime_min;
  s.ov_target_duration_s = a.ov_target_duration_s;
  s.ov_target_volume_l = a.ov_target_volume_l;
  return s;
}

void MajiAutomations::apply_set(const uint8_t *data, size_t len) { this->apply_set_(data, len, true); }

void MajiAutomations::apply_set_(const uint8_t *data, size_t len, bool persist) {
  maji_auto::ApplyResult r = maji_auto::apply_set(data, len, route_set_version_, autos_, ids_, count_);
  switch (r) {
    case maji_auto::APPLY_OK:
      for (int i = 0; i < maji_auto::MAX_AUTOMATIONS; i++) {
        edges_[i].armed = true;
        edges_[i].last_yday = -1;
      }
      applied_route_set_version_ = route_set_version_;
      stale_ = false;
      ESP_LOGI(TAG, "Applied %u automation(s) (route_set_version %u)", count_, route_set_version_);
      break;
    case maji_auto::APPLY_CLEARED:
      for (int i = 0; i < maji_auto::MAX_AUTOMATIONS; i++) {
        edges_[i].armed = true;
        edges_[i].last_yday = -1;
      }
      applied_route_set_version_ = route_set_version_;
      stale_ = false;
      ESP_LOGI(TAG, "Automation set cleared (0 automations)");
      break;
    case maji_auto::APPLY_VERSION_REFUSED:
      stale_ = true;
      ESP_LOGW(TAG, "Automation set route_set_version != baked %u — refused, keeping last-good",
               route_set_version_);
      break;
    case maji_auto::APPLY_TOO_SMALL:
      ESP_LOGW(TAG, "Automation set too small (%u bytes) — ignored", (unsigned) len);
      break;
    case maji_auto::APPLY_BAD_MAGIC:
      ESP_LOGW(TAG, "Automation set bad magic — ignored");
      break;
    case maji_auto::APPLY_TRUNCATED:
      ESP_LOGW(TAG, "Automation set truncated (%u bytes) — ignored", (unsigned) len);
      break;
  }
  // Keep the GET /local/automations serving copy in lockstep with the live table —
  // re-packed from autos_/ids_/count_ (never the sender's raw bytes), so the served
  // blob is always exactly what apply_set accepted. Keep-last-good outcomes leave it
  // untouched, same as the table itself.
  if (r == maji_auto::APPLY_OK || r == maji_auto::APPLY_CLEARED)
    this->refresh_served_();
  // Persist the new last-good blob on a config push (APPLY_OK / APPLY_CLEARED) — a rare
  // event, never per-tick, so flash wear is a non-issue. Keep-last-good outcomes leave
  // both the table and flash untouched. A restore passes persist=false: the blob just
  // loaded IS the flash content, so rewriting it would only burn an erase cycle per boot.
  if (persist && maji_auto::persist_needed(r))
    this->persist_set_(data, len);
}

void MajiAutomations::setup() {
  autos_pref_ = global_preferences->make_preference<AutosBlob>(AUTOS_BLOB_KEY);
  // Runs before any tick(): ESPHome completes all component setup()s before loop()
  // starts, and tick() is driven by the generated interval inside loop().
  this->restore_set_();
  // No persisted set (or a refused restore) means an empty table — publish the valid
  // count-0 header so GET /local/automations has a well-formed answer before any push.
  if (served_len_ == 0)
    this->refresh_served_();
}

size_t MajiAutomations::snapshot_served(uint8_t *out, size_t cap) const {
  // httpd-task reader under the seqlock: an odd sequence (write in flight) or a changed
  // one means the copy raced a refresh — retry. Refreshes only happen on a config push,
  // so a few spins always settle; a persistent loser reports 0 (caller maps to 503).
  for (int tries = 0; tries < 8; tries++) {
    uint32_t s1 = served_seq_.load(std::memory_order_acquire);
    if (s1 & 1)
      continue;
    uint16_t n = served_len_;
    if (n == 0 || n > cap)
      return 0;
    memcpy(out, served_blob_, n);
    if (served_seq_.load(std::memory_order_acquire) == s1)
      return n;
  }
  return 0;
}

void MajiAutomations::refresh_served_() {
  served_seq_.fetch_add(1, std::memory_order_acq_rel);  // odd: write in flight
  served_len_ = (uint16_t) maji_auto::serialize_set(autos_, ids_, count_, route_set_version_, served_blob_,
                                                    sizeof(served_blob_));
  served_seq_.fetch_add(1, std::memory_order_release);  // even: the copy is whole
}

void MajiAutomations::persist_set_(const uint8_t *data, size_t len) {
  size_t used = maji_auto::consumed_blob_bytes(data, len);
  if (used == 0)
    return;  // defensive: persist_needed already gates this
  // The broker replays its retained set on every boot and reconnect — skip the save
  // (and the NVS erase cycle) when flash already holds exactly this blob.
  if (persisted_blob_.size() == used && memcmp(persisted_blob_.data(), data, used) == 0) {
    ESP_LOGD(TAG, "Automation set unchanged — skipping flash write");
    return;
  }
  auto bp = std::unique_ptr<AutosBlob>(new AutosBlob());  // ~1.2 KB: heap, not the stack
  AutosBlob &b = *bp;
  b.magic = maji_auto::AUTOMATION_FLASH_MAGIC;
  b.len = (uint16_t) used;
  memcpy(b.data, data, used);
  autos_pref_.save(&b);
  persisted_blob_.assign((const char *) data, used);
  ESP_LOGD(TAG, "Persisted automation set (%u bytes) to flash", (unsigned) used);
}

void MajiAutomations::restore_set_() {
  auto bp = std::unique_ptr<AutosBlob>(new AutosBlob());  // ~1.2 KB: heap, not the stack
  AutosBlob &b = *bp;
  if (!autos_pref_.load(&b) || !maji_auto::persisted_blob_valid(b.magic, b.len)) {
    ESP_LOGI(TAG, "No persisted automation set — empty until the broker replays");
    return;
  }
  ESP_LOGI(TAG, "Restoring persisted automation set (%u bytes)", (unsigned) b.len);
  // Stash the flash content so a broker replay of the same retained set doesn't trigger
  // a redundant save (persist_set_ compares against this).
  persisted_blob_.assign((const char *) b.data, b.len);
  // Same validation path as an mqtt push: a stale route_set_version is refused and
  // flagged stale, a good set is applied — the kernel logs the outcome. persist=false:
  // the loaded blob is already the flash content.
  this->apply_set_(b.data, b.len, false);
}

bool MajiAutomations::tick(ESPTime now, bool time_trusted) {
  if (control_ == nullptr)
    return false;

  maji_auto::TimeInputs t;
  t.time_ok = time_trusted && now.is_valid();
  if (t.time_ok) {
    t.cur_min = now.hour * 60 + now.minute;
    t.cur_bit = maji_auto::dow_to_bit(now.day_of_week);
    t.cur_yday = now.day_of_year;
  }

  auto &cs = control_->state();
  bool fired = false;
  for (int i = 0; i < count_; i++) {
    maji_auto::RuntimeAutomation &a = autos_[i];
    int rid = a.route_index;
    if (rid < 0 || rid >= (int) cs.routes.size())
      continue;

    // Only fetch a level for level triggers, and only from the route's source tank.
    float level = (a.trigger_type == 1) ? control_->tank_level(cs.routes[rid].source_tank) : NAN;
    if (!maji_auto::should_fire(a, t, level, edges_[i]))
      continue;

    int rc = control_->start_route(rid, "", automation_stopspec(a), maji_ctl::ORIGIN_AUTOMATION, ids_[i]);
    if (rc == 0)
      fired = true;
    // Log the trigger that fired with the detail you read when one misfires in the field:
    // a level fire shows the level vs its threshold; a time fire is self-explanatory.
    if (a.trigger_type == 1)
      ESP_LOGI(TAG, "Level automation %d (%.0f%% > %u%%) -> route %d rc=%d", i, level,
               a.level_threshold_pct, rid, rc);
    else
      ESP_LOGI(TAG, "Time automation %d -> route %d rc=%d", i, rid, rc);
  }
  return fired;
}

void MajiAutomations::dump_config() {
  ESP_LOGCONFIG(TAG, "MajiAutomations: route_set_version=%u, %u loaded%s, config_version=%s",
                route_set_version_, count_, stale_ ? " (last set stale)" : "",
                config_version_.empty() ? "(none)" : config_version_.c_str());
}

}  // namespace maji_automations
}  // namespace esphome
