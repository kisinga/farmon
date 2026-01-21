#pragma once

#include "lib/battery_monitor.h"

class IBatteryHal {
public:
    virtual ~IBatteryHal() = default;

    virtual bool begin() = 0;
    virtual void update(uint32_t nowMs) = 0;
    
    virtual uint16_t getVoltageMilliVolts() = 0;
    virtual uint8_t getBatteryPercent() = 0;
    virtual bool isCharging() const = 0;
};

class BatteryMonitorHal : public IBatteryHal {
public:
    explicit BatteryMonitorHal(const BatteryMonitor::Config& config);
    bool begin() override;
    void update(uint32_t nowMs) override;
    uint16_t getVoltageMilliVolts() override;
    uint8_t getBatteryPercent() override;
    bool isCharging() const override;

private:
    BatteryMonitor::BatteryMonitor _batteryMonitor;
};

BatteryMonitorHal::BatteryMonitorHal(const BatteryMonitor::Config& config) : _batteryMonitor(config) {}

bool BatteryMonitorHal::begin() {
    return true; // Battery monitor begin doesn't require an explicit init
}

void BatteryMonitorHal::update(uint32_t nowMs) {
    _batteryMonitor.updateChargeStatus(nowMs);
}

uint16_t BatteryMonitorHal::getVoltageMilliVolts() {
    bool unused;
    return _batteryMonitor.readBatteryMilliVolts(unused);
}

uint8_t BatteryMonitorHal::getBatteryPercent() {
    uint8_t percent = 0;
    _batteryMonitor.readPercent(percent);
    return percent;
}

bool BatteryMonitorHal::isCharging() const {
    return _batteryMonitor.isCharging();
}
