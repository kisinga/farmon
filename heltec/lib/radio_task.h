#pragma once

#include "lorawan_messages.h"
#include "communication_config.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <stdint.h>

// Forward declarations for RadioLib
class LoRaWANNode;

// =============================================================================
// Radio Task: Dedicated FreeRTOS task for LoRaWAN communication
// =============================================================================
// Owns RadioLib instance, services TX/RX queues, handles join/send/receive.
// Singleton pattern: one radio task per device.
//
// Architecture:
// - Runs in dedicated 8KB stack task (prevents timer daemon starvation)
// - Blocking operations (join, sendReceive) are safe here
// - App communicates via FreeRTOS queues (zero callback overhead)
// - Status polling via atomic volatile flags
// =============================================================================

// Global radio task state (singleton)
struct RadioTaskState {
    QueueHandle_t txQueue;
    QueueHandle_t rxQueue;
    LoRaWANNode* node;
    const LoRaWANConfig* lorawanConfig;  // Applied after join (optional)
    
    // Status flags (atomic access from any task via volatile)
    volatile bool joined;
    volatile uint32_t uplinkCount;
    volatile uint32_t downlinkCount;
    volatile int16_t lastRssi;
    volatile int8_t lastSnr;
};

/**
 * Initialize and start the radio task.
 *
 * @param devEui 8-byte device EUI (MSB first)
 * @param appEui 8-byte application EUI (MSB first)
 * @param appKey 16-byte application key
 * @param lorawanConfig Optional; if non-null, dataRate/minDataRate/txPower/adrEnabled are applied after join
 * @param outState Returns pointer to global state for status queries
 * @return true on success, false on failure
 *
 * Call once during app initialization. Creates queues, initializes RadioLib,
 * and spawns dedicated FreeRTOS task.
 */
bool radioTaskStart(
    const uint8_t* devEui,
    const uint8_t* appEui,
    const uint8_t* appKey,
    const LoRaWANConfig* lorawanConfig,
    RadioTaskState** outState
);

/**
 * Radio task entry point (internal, called by xTaskCreate).
 * 
 * Performs initial OTAA join, then enters main loop:
 * 1. Check TX queue (blocking 50ms)
 * 2. Send uplink if message available (blocks 1-2s for RX windows)
 * 3. Poll for Class C downlinks (non-blocking)
 * 4. Repeat
 */
void radioTaskRun(void* param);
