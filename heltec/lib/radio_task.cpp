#include "radio_task.h"
#include "core_logger.h"
#include "communication_config.h"
#include <RadioLib.h>
#include <heltec_unofficial.h>
#include <Arduino.h>

// =============================================================================
// LoRaWAN Regional Configuration
// =============================================================================
static const LoRaWANBand_t* REGION = &US915;
static const uint8_t SUBBAND = 2;

// =============================================================================
// Global State (Singleton)
// =============================================================================
static RadioTaskState g_radioState = {0};

// =============================================================================
// Helper: RadioLib error string
// =============================================================================
static const char* getRadioLibErrorString(int16_t errorCode) {
    switch (errorCode) {
        case RADIOLIB_ERR_NONE: return "Success";
        case RADIOLIB_ERR_PACKET_TOO_LONG: return "Packet too long";
        case RADIOLIB_ERR_TX_TIMEOUT: return "TX timeout";
        case RADIOLIB_ERR_RX_TIMEOUT: return "RX timeout";
        case RADIOLIB_ERR_CRC_MISMATCH: return "CRC mismatch";
        default:
            if (errorCode == RADIOLIB_LORAWAN_NEW_SESSION) return "New session";
            if (errorCode == RADIOLIB_LORAWAN_SESSION_RESTORED) return "Session restored";
            if (errorCode == -1116) return "No downlink";
            return "Unknown error";
    }
}

// =============================================================================
// Public API: Start Radio Task
// =============================================================================
bool radioTaskStart(
    const uint8_t* devEui,
    const uint8_t* appEui,
    const uint8_t* appKey,
    const LoRaWANConfig* lorawanConfig,
    RadioTaskState** outState
) {
    // Create queues
    g_radioState.txQueue = xQueueCreate(8, sizeof(LoRaWANTxMsg));
    g_radioState.rxQueue = xQueueCreate(4, sizeof(LoRaWANRxMsg));
    if (!g_radioState.txQueue || !g_radioState.rxQueue) {
        LOGE("Radio", "Failed to create queues");
        return false;
    }
    LOGI("Radio", "Queues created (TX: 8 slots, RX: 4 slots)");
    
    // Initialize radio hardware
    int16_t state = radio.begin();
    if (state != RADIOLIB_ERR_NONE) {
        LOGE("Radio", "Radio init failed: %s (%d)", getRadioLibErrorString(state), state);
        return false;
    }
    LOGI("Radio", "SX1262 radio initialized");
    
    // Create LoRaWAN node
    g_radioState.node = new LoRaWANNode(&radio, REGION, SUBBAND);
    if (!g_radioState.node) {
        LOGE("Radio", "Failed to create LoRaWAN node");
        return false;
    }
    
    // Setup OTAA credentials
    uint64_t devEui64 = 0, joinEui64 = 0;
    for (int i = 0; i < 8; i++) {
        devEui64 = (devEui64 << 8) | devEui[i];
        joinEui64 = (joinEui64 << 8) | appEui[i];
    }
    
    LOGI("Radio", "DevEUI: %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X",
         devEui[0], devEui[1], devEui[2], devEui[3],
         devEui[4], devEui[5], devEui[6], devEui[7]);
    
    state = g_radioState.node->beginOTAA(joinEui64, devEui64, (uint8_t*)appKey, (uint8_t*)appKey);
    if (state != RADIOLIB_ERR_NONE) {
        LOGE("Radio", "OTAA setup failed: %s (%d)", getRadioLibErrorString(state), state);
        return false;
    }
    LOGI("Radio", "OTAA configured");
    
    // Create dedicated FreeRTOS task
    TaskHandle_t taskHandle;
    BaseType_t ok = xTaskCreate(
        radioTaskRun,
        "radio",
        8192,  // 8KB stack (RadioLib needs space)
        &g_radioState,
        1,  // Priority (low, non-critical)
        &taskHandle
    );
    if (ok != pdPASS) {
        LOGE("Radio", "Failed to create task");
        return false;
    }
    
    g_radioState.lorawanConfig = lorawanConfig;
    *outState = &g_radioState;
    LOGI("Radio", "Task started (8KB stack, priority 1)");
    return true;
}

// =============================================================================
// Task Entry Point
// =============================================================================
void radioTaskRun(void* param) {
    RadioTaskState* state = (RadioTaskState*)param;
    LoRaWANNode* node = state->node;
    
    if (!node) {
        LOGE("Radio", "Task started with null node");
        vTaskDelete(NULL);
        return;
    }
    
    // =========================================================================
    // Join with retry until success (blocking, OK — we're in dedicated task)
    // =========================================================================
    const uint32_t joinRetryDelayMs = 10000;  // Delay between join attempts
    uint16_t joinAttempt = 0;
    
    for (;;) {
        joinAttempt++;
        LOGI("Radio", "OTAA join attempt %u...", (unsigned)joinAttempt);
        node->clearSession();
        
        uint32_t joinStartMs = millis();
        int16_t joinState = node->activateOTAA();
        uint32_t joinDurationMs = millis() - joinStartMs;
        
        if (joinState == RADIOLIB_LORAWAN_NEW_SESSION || joinState == RADIOLIB_LORAWAN_SESSION_RESTORED) {
            state->joined = true;
            
            // Configure Class C
            node->setClass(2);  // Class C: receiver always on
            
            // Apply data rate, TX power, ADR from config (or defaults)
            uint8_t dr = 3;  // default: DR3 for 222-byte max payload
            uint8_t txPwr = 22;  // default dBm
            bool adr = true;
            const LoRaWANConfig* cfg = state->lorawanConfig;
            if (cfg) {
                dr = cfg->dataRate;
                if (cfg->minDataRate > 0 && dr < cfg->minDataRate) {
                    dr = cfg->minDataRate;
                }
                txPwr = cfg->txPower;
                adr = cfg->adrEnabled;
            }
            node->setDatarate(dr);
            node->setTxPower(txPwr);
            node->setADR(adr);
            
            // Get initial RSSI/SNR from join
            state->lastRssi = radio.getRSSI();
            state->lastSnr = radio.getSNR();
            
            LOGI("Radio", "Joined network in %lu ms (attempt %u, DR%u, %u dBm, ADR=%s)",
                 joinDurationMs, (unsigned)joinAttempt, dr, txPwr, adr ? "on" : "off");
            break;
        }
        
        LOGW("Radio", "Join failed after %lu ms: %s (%d); retrying in %lu s",
             joinDurationMs, getRadioLibErrorString(joinState), joinState,
             (unsigned long)(joinRetryDelayMs / 1000));
        vTaskDelay(pdMS_TO_TICKS(joinRetryDelayMs));
    }
    
    // =========================================================================
    // Main Loop: Service TX/RX queues
    // =========================================================================
    LOGI("Radio", "Entering main loop");
    
    for (;;) {
        // ---------------------------------------------------------------------
        // 1. Check for TX requests (blocking with 50ms timeout)
        // ---------------------------------------------------------------------
        LoRaWANTxMsg txMsg;
        if (xQueueReceive(state->txQueue, &txMsg, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (!state->joined) {
                LOGW("Radio", "TX dropped (not joined): port=%d len=%d", txMsg.port, txMsg.len);
                continue;
            }
            
            // Validate payload size
            if (txMsg.len > 222) {
                LOGW("Radio", "TX dropped (too large): port=%d len=%d", txMsg.port, txMsg.len);
                continue;
            }
            
            LOGD("Radio", "TX: port=%d len=%d confirmed=%d", txMsg.port, txMsg.len, txMsg.confirmed);
            
            // Prepare downlink buffer (stack local, thread-safe)
            uint8_t rxBuf[256];
            size_t rxLen = sizeof(rxBuf);
            LoRaWANEvent_t event;
            
            // Track timing for performance analysis
            uint32_t sendStart = millis();
            
            // Send uplink (BLOCKING 1-2s for RX windows — OK here)
            int16_t result = node->sendReceive(
                txMsg.payload, txMsg.len, txMsg.port,
                rxBuf, &rxLen,
                txMsg.confirmed,
                nullptr,  // No FOptsMask
                &event
            );
            
            uint32_t sendDuration = millis() - sendStart;
            
            // Log timing for OTA progress ACKs to diagnose chunk 2064 issue
            if (txMsg.port == 8) {  // FPORT_OTA_PROGRESS
                uint16_t chunkIndex = txMsg.payload[1] | (txMsg.payload[2] << 8);
                if (chunkIndex % 100 == 0 || chunkIndex >= 2060) {
                    LOGI("Radio", "OTA ACK chunk %u: send took %lu ms, result=%d, heap=%lu, stack=%u",
                         (unsigned)chunkIndex, sendDuration, result,
                         (unsigned long)ESP.getFreeHeap(),
                         (unsigned)uxTaskGetStackHighWaterMark(NULL));
                }
            }
            
            // Handle result
            if (result > 0) {
                // Positive: downlink received in RX window
                state->uplinkCount++;
                
                LOGD("Radio", "TX success, downlink received: port=%d len=%zu", event.fPort, rxLen);
                
                // Send downlink to app if payload present
                if (rxLen > 0 && rxLen <= 222) {
                    LoRaWANRxMsg rxMsg;
                    rxMsg.port = event.fPort;
                    rxMsg.len = rxLen;
                    rxMsg.rssi = radio.getRSSI();
                    rxMsg.snr = radio.getSNR();
                    memcpy(rxMsg.payload, rxBuf, rxLen);
                    
                    state->lastRssi = rxMsg.rssi;
                    state->lastSnr = rxMsg.snr;
                    state->downlinkCount++;
                    
                    if (xQueueSend(state->rxQueue, &rxMsg, 0) != pdTRUE) {
                        LOGW("Radio", "RX queue full, dropping downlink");
                    }
                }
            } else if (result == RADIOLIB_ERR_NONE) {
                // Zero: TX success but no downlink (or no ACK for confirmed)
                if (txMsg.confirmed) {
                    LOGW("Radio", "Confirmed TX sent but no ACK received");
                } else {
                    state->uplinkCount++;
                    LOGD("Radio", "TX success, no downlink");
                }
            } else {
                // Negative: error
                LOGW("Radio", "TX failed: %s (%d)", getRadioLibErrorString(result), result);
            }
        }
        
        // ---------------------------------------------------------------------
        // 2. Poll for Class C downlinks (non-blocking)
        // ---------------------------------------------------------------------
        if (state->joined) {
            uint8_t rxBuf[256];
            size_t rxLen = sizeof(rxBuf);
            LoRaWANEvent_t event;
            
            int16_t result = node->getDownlinkClassC(rxBuf, &rxLen, &event);
            if (result > 0 && rxLen > 0 && rxLen <= 222) {
                LOGD("Radio", "Class C downlink: port=%d len=%zu", event.fPort, rxLen);
                
                LoRaWANRxMsg rxMsg;
                rxMsg.port = event.fPort;
                rxMsg.len = rxLen;
                rxMsg.rssi = radio.getRSSI();
                rxMsg.snr = radio.getSNR();
                memcpy(rxMsg.payload, rxBuf, rxLen);
                
                state->lastRssi = rxMsg.rssi;
                state->lastSnr = rxMsg.snr;
                state->downlinkCount++;
                
                if (xQueueSend(state->rxQueue, &rxMsg, 0) != pdTRUE) {
                    LOGW("Radio", "RX queue full, dropping Class C downlink");
                }
            }
        }
        
        // Loop repeats every ~50ms (from xQueueReceive timeout)
    }
}
