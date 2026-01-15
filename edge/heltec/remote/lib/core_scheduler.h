#pragma once

#include <Arduino.h>
#include <functional>
#include <string>
#include <vector>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "core_config.h" 
#include "rtos_scheduler.h" // Use the full implementation

// Forward declarations for service interfaces used in task callbacks
class IBatteryService;
class ICommsService;

// Generic app state for common tasks
struct CommonAppState {
    uint32_t nowMs = 0;
    bool heartbeatOn = false;
    // Add other common state variables as needed
};

class CoreScheduler {
public:
    explicit CoreScheduler(uint32_t defaultTaskStackSize = 2048);
    ~CoreScheduler();

    bool registerTask(const std::string& name, RtosTaskCallback<CommonAppState> callback, uint32_t intervalMs);
    void start(CommonAppState& initialState);

private:
    // Use the templated task manager directly
    RtosTaskManager<CommonAppState> _taskManager;
};
