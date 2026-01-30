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
    bool setTaskInterval(const std::string& name, uint32_t newIntervalMs);
    void start(CommonAppState& initialState);

private:
    // Use the templated task manager directly
    RtosTaskManager<CommonAppState> _taskManager;
};
