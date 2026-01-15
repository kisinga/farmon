#include "svc_comms.h"

CommsService::CommsService() {}

void CommsService::setLoRaWANHal(ILoRaWANHal* lorawanHal) {
    _lorawanHal = lorawanHal;
}

void CommsService::setWifiHal(IWifiHal* wifiHal) {
    _wifiHal = wifiHal;
}

void CommsService::update(uint32_t nowMs) {
    if (_lorawanHal) {
        _lorawanHal->tick(nowMs);
    }
    if (_wifiHal) {
        _wifiHal->update(nowMs);
    }
}

bool CommsService::sendMessage(const Messaging::Message& message, TransportType transport) {
    switch (transport) {
        case TransportType::LoRaWAN:
            if (_lorawanHal) {
                // Use default port 1 for telemetry, confirmed based on message metadata
                return _lorawanHal->sendData(1, message.getPayload(), message.getLength(), message.getMetadata().requiresAck);
            }
            break;
        case TransportType::WiFi:
            if (_wifiHal) {
                return _wifiHal->uplink(message.getPayload(), message.getLength());
            }
            break;
        // Other transport types can be added here
        default:
            return false;
    }
    return false;
}
