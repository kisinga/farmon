#pragma once

#include <stdint.h>
#include "hal_wifi.h"

class IWifiService {
public:
    virtual ~IWifiService() = default;
    virtual void update(uint32_t nowMs) = 0;
    virtual bool isConnected() const = 0;
    virtual int8_t getSignalStrengthPercent() const = 0;
    virtual bool isMqttConnected() const = 0;
};

class WifiService : public IWifiService {
public:
    explicit WifiService(IWifiHal& hal);

    void update(uint32_t nowMs) override;
    bool isConnected() const override;
    int8_t getSignalStrengthPercent() const override;
    bool isMqttConnected() const override;

private:
    IWifiHal& wifiHal;
};
