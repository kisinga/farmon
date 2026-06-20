#pragma once
// Imperative shell for the runtime automation engine. Holds the RAM automation table +
// per-automation edge state; the mqtt on_message lambda fills it via apply_set (retained
// binary set), and a generated 5s interval calls tick(). The shell is the only place
// touching id()/SNTP/the control engine — all decision logic lives in core.{h,cpp}.
//
// One-directional dependency on maji_control: a fired trigger goes through
// control_->start_route, so the SAME route state machine still gates safety.
#include "core.h"
#include "../maji_control/maji_control.h"
#include "esphome/core/component.h"
#include "esphome/core/time.h"
#include <cstddef>
#include <cstdint>

namespace esphome {
namespace maji_automations {

class MajiAutomations : public Component {
 public:
  void set_control(maji_control::MajiControl *c) { control_ = c; }
  void set_route_set_version(uint16_t v) { route_set_version_ = v; }

  void dump_config() override;

  // Fill the table from a retained binary message (mqtt on_message). Validates magic +
  // route_set_version + length; on mismatch keeps the last-good set and flags stale.
  void apply_set(const uint8_t *data, size_t len);

  // Generic 5s evaluator. Time triggers gate on `time_trusted`; level triggers read the
  // route's source tank via the control engine. A fire goes through start_route (all
  // pre-checks apply), tagged origin=AUTOMATION + the automation's whole id. Returns true
  // if anything started this pass, so the caller can nudge an immediate snapshot.
  bool tick(ESPTime now, bool time_trusted);

 protected:
  maji_control::MajiControl *control_{nullptr};
  uint16_t route_set_version_{0};

  // Runtime table + per-automation edge state. Safe without a lock ONLY because ESPHome
  // dispatches both apply_set (mqtt receive) and tick (interval) in loop().
  maji_auto::RuntimeAutomation autos_[maji_auto::MAX_AUTOMATIONS];
  char ids_[maji_auto::MAX_AUTOMATIONS][maji_auto::AUTOMATION_ID_BYTES];
  uint8_t count_{0};
  maji_auto::EdgeState edges_[maji_auto::MAX_AUTOMATIONS];
  uint16_t applied_route_set_version_{0};
  bool stale_{false};  // last set refused (version mismatch)
};

}  // namespace maji_automations
}  // namespace esphome
