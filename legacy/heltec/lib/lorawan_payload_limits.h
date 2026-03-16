#pragma once

#include <stdint.h>
#include "communication_config.h"

// Maximum application payload size (bytes) per data rate
// These are the actual limits after LoRaWAN protocol overhead
// Source: LoRaWAN Regional Parameters specification

// US915 region limits
static const uint8_t US915_PAYLOAD_LIMITS[] = {
    11,   // DR0: SF10/125kHz
    53,   // DR1: SF9/125kHz
    125,  // DR2: SF8/125kHz
    222,  // DR3: SF7/125kHz
    222,  // DR4: SF8/500kHz
    11    // DR5: LR-FHSS (not well supported, use DR1-DR4 instead)
};
static const uint8_t US915_PAYLOAD_LIMITS_SIZE = sizeof(US915_PAYLOAD_LIMITS) / sizeof(US915_PAYLOAD_LIMITS[0]);

// EU868 region limits
static const uint8_t EU868_PAYLOAD_LIMITS[] = {
    51,   // DR0: SF12/125kHz
    51,   // DR1: SF11/125kHz
    51,   // DR2: SF10/125kHz
    115,  // DR3: SF9/125kHz
    222,  // DR4: SF8/125kHz
    222,  // DR5: SF7/125kHz
    222,  // DR6: SF7/250kHz
    222   // DR7: FSK
};
static const uint8_t EU868_PAYLOAD_LIMITS_SIZE = sizeof(EU868_PAYLOAD_LIMITS) / sizeof(EU868_PAYLOAD_LIMITS[0]);

/**
 * Get maximum payload size for a given region and data rate
 * @param region LoRaWAN region
 * @param dataRate Data rate (0-7 depending on region)
 * @return Maximum payload size in bytes, or 0 if invalid
 */
inline uint8_t getMaxPayloadSize(LoRaWANRegion region, uint8_t dataRate) {
    switch (region) {
        case LoRaWANRegion::US915:
            if (dataRate < US915_PAYLOAD_LIMITS_SIZE) {
                return US915_PAYLOAD_LIMITS[dataRate];
            }
            break;
        case LoRaWANRegion::EU868:
            if (dataRate < EU868_PAYLOAD_LIMITS_SIZE) {
                return EU868_PAYLOAD_LIMITS[dataRate];
            }
            break;
        default:
            // Unknown region, return conservative default
            return 51;
    }
    return 0;  // Invalid data rate
}

/**
 * Get minimum data rate that supports the given payload size
 * @param region LoRaWAN region
 * @param payloadSize Payload size in bytes
 * @return Minimum data rate that supports the payload, or 255 if no DR supports it
 * Note: For US915, skips DR5 (LR-FHSS) as it's not well supported by RadioLib/gateways
 */
inline uint8_t getMinDataRateForPayload(LoRaWANRegion region, uint8_t payloadSize) {
    const uint8_t* limits = nullptr;
    uint8_t limitsSize = 0;
    uint8_t maxDR = 255;  // Maximum DR to check
    
    switch (region) {
        case LoRaWANRegion::US915:
            limits = US915_PAYLOAD_LIMITS;
            limitsSize = US915_PAYLOAD_LIMITS_SIZE;
            maxDR = 4;  // Skip DR5 (LR-FHSS) on US915 - not well supported
            break;
        case LoRaWANRegion::EU868:
            limits = EU868_PAYLOAD_LIMITS;
            limitsSize = EU868_PAYLOAD_LIMITS_SIZE;
            break;
        default:
            return 255;  // Unknown region
    }
    
    // Find the lowest data rate that supports this payload size
    uint8_t checkLimit = (maxDR < limitsSize) ? maxDR : limitsSize;
    for (uint8_t dr = 0; dr < checkLimit; dr++) {
        if (limits[dr] >= payloadSize) {
            return dr;
        }
    }
    
    return 255;  // No data rate supports this payload size
}
