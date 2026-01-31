#pragma once

#include <stdint.h>
#include <functional>
#include <vector>
#include <utility>

/**
 * DownlinkRouter — port-based dispatch for LoRaWAN downlinks.
 *
 * Register handlers per port or port range. dispatch() invokes the first matching handler.
 * Handler returns true if it consumed the message (no further handlers).
 */
class DownlinkRouter {
public:
    using DownlinkHandler = std::function<bool(uint8_t port, const uint8_t* payload, uint8_t len)>;

    DownlinkRouter() = default;

    /** Register handler for a single port. */
    void registerHandler(uint8_t port, DownlinkHandler fn);

    /** Register handler for port range [portLow, portHigh] inclusive. */
    void registerHandlerRange(uint8_t portLow, uint8_t portHigh, DownlinkHandler fn);

    /** Dispatch to first matching handler. */
    void dispatch(uint8_t port, const uint8_t* payload, uint8_t len);

private:
    struct Entry {
        uint8_t portLow;
        uint8_t portHigh;
        DownlinkHandler fn;
    };
    std::vector<Entry> _handlers;
};
