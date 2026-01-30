#pragma once

#include "core_config.h"

// Initializes board hardware (heltec_setup), serial, logger, and external power.
class CoreSystem {
public:
    CoreSystem();
    void init(const DeviceConfig& config);
};
