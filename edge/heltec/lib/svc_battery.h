#pragma once

#include <stdint.h>
#include "hal_battery.h"

class IBatteryService {
public:
    virtual ~IBatteryService() = default;
    virtual void update(uint32_t nowMs) = 0;
    virtual uint8_t getBatteryPercent() const = 0;
    virtual bool isCharging() const = 0;
};

class BatteryService : public IBatteryService {
public:
    explicit BatteryService(IBatteryHal& hal);

    void update(uint32_t nowMs) override;
    uint8_t getBatteryPercent() const override;
    bool isCharging() const override;

private:
    IBatteryHal& batteryHal;
};
