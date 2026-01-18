#include "svc_comms.h"

CommsService::CommsService() {}

void CommsService::setLoRaWANHal(ILoRaWANHal* lorawanHal) {
    _lorawanHal = lorawanHal;
}

void CommsService::update(uint32_t nowMs) {
    if (_lorawanHal) {
        _lorawanHal->tick(nowMs);
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
        // Other transport types can be added here
        default:
            return false;
    }
    return false;
}
