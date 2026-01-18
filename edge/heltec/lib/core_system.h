#pragma once

#include "core_config.h"
#include "core_scheduler.h"
#include "lib/display.h"

// Forward declarations
class LoRaComm;
class WifiManager;
namespace BatteryMonitor {
  class BatteryMonitor;
  struct Config;
}

class CoreSystem {
public:
    CoreSystem();

    void init(const DeviceConfig& config);

    // Getter methods for services can be added here if needed
    // e.g., OledDisplay& getDisplay();

private:
    CommonAppState appState;
    CoreScheduler scheduler;
};
