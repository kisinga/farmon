#pragma once

#include <cstdint>
#include <cstdio>
#include <cstring>
#include "protocol_constants.h"

namespace CommandTranslator {

// Translate a command (port + payload) to a human-readable description
// Returns pointer to buf (for convenience)
inline const char* translate(uint8_t port, const uint8_t* payload, uint8_t len,
                              char* buf, size_t bufSize) {
    buf[0] = '\0';

    switch (port) {
        case FPORT_REG_ACK:
            snprintf(buf, bufSize, "Registered OK");
            break;

        case FPORT_CMD_RESET:
            snprintf(buf, bufSize, "Reset counters");
            break;

        case FPORT_CMD_INTERVAL:
            if (len >= 4) {
                uint32_t intervalMs = ((uint32_t)payload[0] << 24) |
                                      ((uint32_t)payload[1] << 16) |
                                      ((uint32_t)payload[2] << 8) |
                                      payload[3];
                snprintf(buf, bufSize, "Set interval: %lus", intervalMs / 1000);
            } else {
                snprintf(buf, bufSize, "Set interval");
            }
            break;

        case FPORT_CMD_REBOOT:
            snprintf(buf, bufSize, "Rebooting...");
            break;

        case FPORT_CMD_CLEAR_ERR:
            snprintf(buf, bufSize, "Clear errors");
            break;

        case FPORT_CMD_FORCE_REG:
            snprintf(buf, bufSize, "Force register");
            break;

        case FPORT_CMD_STATUS:
            snprintf(buf, bufSize, "Status request");
            break;

        case FPORT_CMD_DISPLAY_TIMEOUT:
            if (len >= 2) {
                uint16_t timeoutSec = ((uint16_t)payload[0] << 8) | payload[1];
                snprintf(buf, bufSize, "Display off: %us", timeoutSec);
            } else {
                snprintf(buf, bufSize, "Set display timeout");
            }
            break;

        case FPORT_DIRECT_CTRL:
            if (len >= 2) {
                uint8_t ctrlIdx = payload[0];
                uint8_t stateIdx = payload[1];
                // Generic names - the app can enhance with schema if needed
                const char* ctrlNames[] = {"Pump", "Valve"};
                const char* stateNames[] = {"off", "on"};
                const char* ctrlName = (ctrlIdx < 2) ? ctrlNames[ctrlIdx] : "Control";
                const char* stateName = (stateIdx < 2) ? stateNames[stateIdx] : "?";
                snprintf(buf, bufSize, "%s: %s", ctrlName, stateName);
            } else {
                snprintf(buf, bufSize, "Direct control");
            }
            break;

        case FPORT_RULE_UPDATE:
            if (len >= 2 && payload[0] == 0xFF && payload[1] == 0x00) {
                snprintf(buf, bufSize, "Clear all rules");
            } else if (len >= 2 && (payload[1] & 0x80)) {
                snprintf(buf, bufSize, "Delete rule %d", payload[0]);
            } else if (len >= 1) {
                snprintf(buf, bufSize, "Update rule %d", payload[0]);
            } else {
                snprintf(buf, bufSize, "Rule update");
            }
            break;

        default:
            snprintf(buf, bufSize, "Port %d cmd", port);
            break;
    }

    return buf;
}

} // namespace CommandTranslator
