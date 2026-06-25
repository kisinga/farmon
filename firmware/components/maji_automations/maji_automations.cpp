#include "maji_automations.h"
#include "esphome/core/log.h"
#include <cmath>

namespace esphome {
namespace maji_automations {

static const char *const TAG = "auto";

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

void MajiAutomations::apply_set(const uint8_t *data, size_t len) {
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
