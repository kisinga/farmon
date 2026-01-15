#include "core_scheduler.h"
#include "core_logger.h"
#include <Arduino.h>

CoreScheduler::CoreScheduler(uint32_t defaultTaskStackSize) 
    : _taskManager(defaultTaskStackSize) {
}

CoreScheduler::~CoreScheduler() {
    // No-op
}

bool CoreScheduler::registerTask(const std::string& name, RtosTaskCallback<CommonAppState> callback, uint32_t intervalMs) {
    return _taskManager.addTask(name, callback, intervalMs);
}

void CoreScheduler::start(CommonAppState& initialState) {
    _taskManager.start(initialState);
}
