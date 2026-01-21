#include "svc_battery.h"

BatteryService::BatteryService(IBatteryHal& hal) : batteryHal(hal) {}

void BatteryService::update(uint32_t nowMs) {
    batteryHal.update(nowMs);
}

uint8_t BatteryService::getBatteryPercent() const {
    // The HAL currently returns 0 on failure. This service might want to cache the last known good value.
    // For now, we'll just pass it through.
    return batteryHal.getBatteryPercent();
}

bool BatteryService::isCharging() const {
    return batteryHal.isCharging();
}
