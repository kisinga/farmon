#include "svc_wifi.h"

WifiService::WifiService(IWifiHal& hal) : wifiHal(hal) {}

void WifiService::update(uint32_t nowMs) {
    wifiHal.update(nowMs);
}

bool WifiService::isConnected() const {
    return wifiHal.isConnected();
}

int8_t WifiService::getSignalStrengthPercent() const {
    return wifiHal.getSignalStrengthPercent();
}

bool WifiService::isMqttConnected() const {
    return wifiHal.isMqttConnected();
}
