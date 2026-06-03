#pragma once

#include <stdint.h>

// =============================================================================
// LoRaWAN Message Types for FreeRTOS Queue Communication
// =============================================================================
// Plain C structs for zero-overhead queue-based communication between
// application tasks and the dedicated radio task.
//
// Design principles:
// - Inline buffers (no heap, no pointer indirection)
// - Plain C structs (memcpy-safe, no vtables)
// - Fixed size for FreeRTOS queue compatibility
// =============================================================================

// TX request: app → radio task
struct LoRaWANTxMsg {
    uint8_t port;
    uint8_t len;
    bool confirmed;
    uint8_t payload[222];  // DR3 max payload size, inline buffer
};

// RX event: radio task → app
struct LoRaWANRxMsg {
    uint8_t port;
    uint8_t len;
    int16_t rssi;
    int8_t snr;
    uint8_t payload[222];  // Inline buffer
};

// Size verification (should be acceptable for queue storage)
static_assert(sizeof(LoRaWANTxMsg) == 225, "TxMsg size changed");
static_assert(sizeof(LoRaWANRxMsg) == 228, "RxMsg size changed");
