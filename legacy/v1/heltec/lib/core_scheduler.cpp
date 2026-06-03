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

bool CoreScheduler::registerBlockingTask(const std::string& name, RtosTaskCallback<CommonAppState> callback, uint32_t intervalMs) {
    return _taskManager.addBlockingTask(name, callback, intervalMs);
}

bool CoreScheduler::setTaskInterval(const std::string& name, uint32_t newIntervalMs) {
    return _taskManager.setTaskInterval(name, newIntervalMs);
}

void CoreScheduler::start(CommonAppState& initialState) {
    _taskManager.start(initialState);
}
