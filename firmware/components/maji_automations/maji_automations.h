#pragma once
// Imperative shell for the runtime automation engine. Holds the RAM automation table +
// per-automation edge state; the mqtt on_message lambda fills it via apply_set (retained
// binary set), and a generated 5s interval calls tick(). The shell is the only place
// touching id()/SNTP/the control engine — all decision logic lives in core.{h,cpp}.
//
// The last-good set is also persisted to NVS (raw validated wire blob) on every
// APPLY_OK / APPLY_CLEARED, and restored in setup() through the same validation path,
// so schedules survive reboots and power cuts without a broker replay. A save is
// skipped when the blob already matches flash (the broker's retained set is replayed
// on every boot/reconnect — rewriting it would burn an erase cycle per flap).
//
// One-directional dependency on maji_control: a fired trigger goes through
// control_->start_route, so the SAME route state machine still gates safety.
#include "core.h"
#include "../maji_control/maji_control.h"
#include "esphome/core/component.h"
#include "esphome/core/preferences.h"
#include "esphome/core/time.h"
#include <cstddef>
#include <cstdint>
#include <string>

namespace esphome {
namespace maji_automations {

class MajiAutomations : public Component {
 public:
  void set_control(maji_control::MajiControl *c) { control_ = c; }
  void set_route_set_version(uint16_t v) { route_set_version_ = v; }

  void dump_config() override;

  // Restore the persisted automation set from NVS before the first tick(). ESPHome runs
  // every component's setup() before the loop starts, and tick() is driven by the
  // generated interval inside loop() — so a set restored here is already live for the
  // first evaluation, no ordering race.
  void setup() override;

  // Fill the table from a retained binary message (mqtt on_message). Validates magic +
  // route_set_version + length; on mismatch keeps the last-good set and flags stale.
  // A successful apply/clear also persists the raw wire blob to NVS.
  void apply_set(const uint8_t *data, size_t len);

  // Desired-config version round-trip. The server computes an opaque version string for
  // the retained /config message and embeds it; the device stores it verbatim (it NEVER
  // hashes) and re-emits it in the snapshot as `config_version`, so the server can
  // reconcile desired vs applied config. The per-number applies are done in the generated
  // config-apply lambda (mqtt.ts) — this only carries the version string.
  void set_config_version(const std::string &v) { config_version_ = v; }
  const std::string &config_version() const { return config_version_; }

  // Generic 5s evaluator. Time triggers gate on `time_trusted`; level triggers read the
  // route's source tank via the control engine. A fire goes through start_route (all
  // pre-checks apply), tagged origin=AUTOMATION + the automation's whole id. Returns true
  // if anything started this pass, so the caller can nudge an immediate snapshot.
  bool tick(ESPTime now, bool time_trusted);

 protected:
  void apply_set_(const uint8_t *data, size_t len, bool persist);  // apply + persist gate
  void persist_set_(const uint8_t *data, size_t len);  // write the consumed wire blob to NVS
  void restore_set_();  // load the NVS blob and replay it through apply_set (setup only)

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
  std::string config_version_;  // opaque desired-config version last applied (round-tripped, never hashed)
  ESPPreferenceObject autos_pref_;  // NVS handle for the persisted automation set
  // Copy of the blob currently in flash (stashed at restore and after each save) so a
  // replayed retained set that changes nothing doesn't cost an NVS erase cycle.
  std::string persisted_blob_;
};

}  // namespace maji_automations
}  // namespace esphome
