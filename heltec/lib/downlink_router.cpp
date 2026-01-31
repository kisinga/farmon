#include "downlink_router.h"

void DownlinkRouter::registerHandler(uint8_t port, DownlinkHandler fn) {
    _handlers.push_back({port, port, std::move(fn)});
}

void DownlinkRouter::registerHandlerRange(uint8_t portLow, uint8_t portHigh, DownlinkHandler fn) {
    _handlers.push_back({portLow, portHigh, std::move(fn)});
}

void DownlinkRouter::dispatch(uint8_t port, const uint8_t* payload, uint8_t len) {
    for (auto& entry : _handlers) {
        if (port >= entry.portLow && port <= entry.portHigh) {
            if (entry.fn && entry.fn(port, payload, len)) {
                return;
            }
        }
    }
}
