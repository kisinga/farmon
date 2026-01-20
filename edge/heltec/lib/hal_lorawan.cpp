#include "hal_lorawan.h"
#include "core_logger.h"
#include "lorawan_payload_limits.h"
#include "communication_config.h"

// Include Heltec library which provides the radio instance
#include <heltec_unofficial.h>
#include <RadioLib.h>
#include <EEPROM.h>  // For clearing RadioLib's persistent storage

// Helper function to translate common RadioLib error codes to human-readable messages
static const char* getRadioLibErrorString(int16_t errorCode) {
    // Common RadioLib errors
    switch (errorCode) {
        case RADIOLIB_ERR_NONE: return "Success";
        case RADIOLIB_ERR_PACKET_TOO_LONG: return "Packet too long";
        case RADIOLIB_ERR_TX_TIMEOUT: return "TX timeout";
        case RADIOLIB_ERR_RX_TIMEOUT: return "RX timeout";
        case RADIOLIB_ERR_CRC_MISMATCH: return "CRC mismatch";
        case RADIOLIB_ERR_INVALID_DATA_RATE: return "Invalid data rate";
        case RADIOLIB_ERR_INVALID_RX_PERIOD: return "Invalid RX period";
        case RADIOLIB_ERR_INVALID_FREQUENCY: return "Invalid frequency";
        case RADIOLIB_ERR_INVALID_BANDWIDTH: return "Invalid bandwidth";
        case RADIOLIB_ERR_INVALID_SPREADING_FACTOR: return "Invalid spreading factor";
        case RADIOLIB_ERR_INVALID_OUTPUT_POWER: return "Invalid output power";
        default:
            // LoRaWAN specific success codes
            if (errorCode == RADIOLIB_LORAWAN_NEW_SESSION) return "New session established";
            if (errorCode == RADIOLIB_LORAWAN_SESSION_RESTORED) return "Session restored";
            // Common LoRaWAN error codes (may vary by RadioLib version)
            // Note: Some error codes may have been renamed or removed in RadioLib 7.x
            // Handle specific known error codes
            if (errorCode == -28) {
                return "LoRaWAN node not ready (possibly not joined or invalid state)";
            }
            // Return generic message for unknown codes
            return "Unknown error";
    }
}

// =============================================================================
// LoRaWAN Regional Configuration
// =============================================================================
// These are compile-time constants shared across all HAL instances.
// To change region/sub-band:
//   1. Modify the constants below
//   2. Rebuild firmware
//   3. Ensure gateway and ChirpStack are configured for the same region
//
// Supported regions: US915, EU868, AU915, AS923, IN865, KR920, CN779, CN470
// For US915/AU915, sub-band selects which 8 channels to use (1-8)
// =============================================================================
static const LoRaWANBand_t* region = &US915;
static const uint8_t subBand = 2;
static const LoRaWANRegion lorawanRegion = LoRaWANRegion::US915;  // For payload limit lookups

LoRaWANHal::LoRaWANHal() {
    memset(storedDevEui, 0, sizeof(storedDevEui));
    memset(storedAppEui, 0, sizeof(storedAppEui));
    memset(storedAppKey, 0, sizeof(storedAppKey));
    memset(downlinkBuffer, 0, sizeof(downlinkBuffer));
    downlinkLength = 0;
    downlinkPort = 0;
    hasDownlink = false;
}

LoRaWANHal::~LoRaWANHal() {
    // Clean up resources owned by this instance
    // Note: radio instance is not owned by this HAL (it's a singleton)
    if (node) {
        delete node;
        node = nullptr;
    }
    // Clear downlink buffer state
    hasDownlink = false;
    downlinkLength = 0;
    downlinkPort = 0;
}

bool LoRaWANHal::begin(const uint8_t* devEui, const uint8_t* appEui, const uint8_t* appKey) {
    if (initialized) {
        LOGW("LoRaWAN", "Already initialized");
        return false;
    }

    LOGI("LoRaWAN", "Initializing RadioLib HAL...");

    // Store credentials for later use
    memcpy(storedDevEui, devEui, 8);
    memcpy(storedAppEui, appEui, 8);
    memcpy(storedAppKey, appKey, 16);

    // Log the DevEUI being used
    LOGI("LoRaWAN", "DevEUI: %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X",
         devEui[0], devEui[1], devEui[2], devEui[3],
         devEui[4], devEui[5], devEui[6], devEui[7]);

    // Initialize the radio hardware
    // Note: 'radio' is a singleton instance from heltec_unofficial.h
    // Multiple HAL instances share the same radio hardware
    LOGI("LoRaWAN", "Initializing SX1262 radio...");
    int16_t state = radio.begin();
    if (state != RADIOLIB_ERR_NONE) {
        const char* errorMsg = getRadioLibErrorString(state);
        LOGE("LoRaWAN", "Radio init failed: %s (code %d)", errorMsg, state);
        return false;
    }
    LOGI("LoRaWAN", "Radio initialized successfully");

    // Clear RadioLib's persistent storage to reset DevNonce
    // RadioLib uses EEPROM starting at address 0 by default (~448 bytes)
    // This prevents "DevNonce has already been used" errors after reboot
    // Note: For testing only - in production, DevNonce should persist properly
    LOGI("LoRaWAN", "Clearing RadioLib persistent storage to reset DevNonce...");
    if (!EEPROM.begin(512)) {
        LOGW("LoRaWAN", "Failed to initialize EEPROM for clearing");
    } else {
        // Clear the region RadioLib uses (first 448 bytes)
        for (int i = 0; i < 448; i++) {
            EEPROM.write(i, 0xFF);  // Clear with 0xFF (erased state)
        }
        if (EEPROM.commit()) {
            LOGI("LoRaWAN", "RadioLib EEPROM cleared (448 bytes)");
        } else {
            LOGW("LoRaWAN", "Failed to commit EEPROM clear");
        }
        EEPROM.end();
    }

    // Create LoRaWAN node instance (owned by this HAL instance)
    // Each HAL instance has its own node, but they share the radio hardware
    // Region and sub-band are compile-time constants (see above)
    node = new LoRaWANNode(&radio, region, subBand);

    // Convert 8-byte arrays to uint64_t for RadioLib API
    uint64_t devEui64 = 0;
    uint64_t joinEui64 = 0;
    for (int i = 0; i < 8; i++) {
        devEui64 = (devEui64 << 8) | devEui[i];
        joinEui64 = (joinEui64 << 8) | appEui[i];
    }

    // Setup OTAA credentials
    // For LoRaWAN 1.0.x, nwkKey and appKey are the same
    state = node->beginOTAA(joinEui64, devEui64, (uint8_t*)appKey, (uint8_t*)appKey);
    if (state != RADIOLIB_ERR_NONE) {
        LOGE("LoRaWAN", "OTAA setup failed with code %d", state);
        return false;
    }

    initialized = true;
    LOGI("LoRaWAN", "HAL initialized - call join() to connect to network");

    return true;
}

void LoRaWANHal::tick(uint32_t nowMs) {
    if (!initialized) return;

    // Update connection state based on joined flag (source of truth)
    // Note: join() is blocking, so state changes happen there, not here
    if (joined && connectionState != ConnectionState::Connected) {
        connectionState = ConnectionState::Connected;
    } else if (!joined && connectionState == ConnectionState::Connected) {
        // Lost connection (shouldn't happen without explicit disconnect)
        connectionState = ConnectionState::Disconnected;
        LOGW("LoRaWAN", "Connection lost");
    }

    // Process any pending downlinks (from confirmed uplinks or Class A RX windows)
    if (hasDownlink && onDataCb) {
        // Bounds check before callback
        if (downlinkLength <= sizeof(downlinkBuffer)) {
            onDataCb(downlinkPort, downlinkBuffer, downlinkLength);
        } else {
            LOGW("LoRaWAN", "Downlink length %zu exceeds buffer size, dropping", downlinkLength);
        }
        
        // Re-apply configured data rate after processing downlink in case ADR changed it
        // This ensures our data rate matches our configuration, not what ADR requested
        if (node && joined && configuredDataRate > 0) {
            node->setDatarate(configuredDataRate);
            currentDataRate = configuredDataRate;
            LOGD("LoRaWAN", "Data rate re-applied to DR%d after processing downlink (ADR may have changed it)",
                 configuredDataRate);
        }
        
        // Always clear downlink flag after processing (even if callback fails)
        hasDownlink = false;
        downlinkLength = 0;
        downlinkPort = 0;
    }
}

bool LoRaWANHal::sendData(uint8_t port, const uint8_t *payload, uint8_t length, bool confirmed) {
    // Validation checks
    if (!initialized) {
        LOGW("LoRaWAN", "Cannot send: HAL not initialized");
        return false;
    }
    
    if (!joined) {
        LOGW("LoRaWAN", "Cannot send: not joined to network");
        return false;
    }
    
    if (!node) {
        LOGE("LoRaWAN", "Cannot send: node not created");
        return false;
    }

    // Validate payload size (LoRaWAN max is 242 bytes, but actual max depends on data rate)
    // Use conservative limit to avoid RADIOLIB_ERR_PACKET_TOO_LONG
    if (length == 0) {
        LOGW("LoRaWAN", "Cannot send: payload is empty");
        return false;
    }
    
    if (length > 242) {
        LOGW("LoRaWAN", "Payload too large: %d bytes (max 242)", length);
        return false;
    }

    // Re-apply configured data rate before transmission to ensure RadioLib's
    // internal state matches our configuration. This prevents mismatches from
    // ADR or other state changes that may have occurred since last transmission.
    if (configuredDataRate > 0) {
        node->setDatarate(configuredDataRate);
        currentDataRate = configuredDataRate;
        uint8_t maxPayload = ::getMaxPayloadSize(lorawanRegion, configuredDataRate);
        LOGD("LoRaWAN", "Data rate set to DR%d (max payload: %d bytes) before transmission",
             configuredDataRate, maxPayload);
    }

    LOGD("LoRaWAN", "Sending %d bytes on port %d (confirmed: %s, DR%d)",
         length, port, confirmed ? "true" : "false", currentDataRate);

    int16_t state;
    
    if (confirmed) {
        // For confirmed uplinks, wait for ACK in RX windows
        downlinkLength = sizeof(downlinkBuffer);
        state = node->sendReceive((uint8_t*)payload, length, port, downlinkBuffer, &downlinkLength, true);
        
        if (state == RADIOLIB_ERR_NONE) {
            // Uplink sent successfully, but no ACK received (network may still process it)
            LOGD("LoRaWAN", "Confirmed uplink sent, no ACK received");
            uplinkCount++;
            lastActivityMs = millis();
            if (onTxDoneCb) onTxDoneCb();
            return true;
        } else if (state > 0) {
            // Positive values indicate ACK or data received in Rx window 1 or 2
            // Check if it's an ACK (empty payload) or actual data downlink
            bool isAck = (downlinkLength == 0);
            if (isAck) {
                LOGD("LoRaWAN", "Confirmed uplink sent, ACK received");
            } else {
                LOGI("LoRaWAN", "Confirmed uplink sent, downlink received (%d bytes)", (int)downlinkLength);
            }
            
            uplinkCount++;
            if (!isAck) {
                downlinkCount++;
            }
            lastActivityMs = millis();

            // Get RSSI/SNR from last reception
            lastRssiDbm = radio.getRSSI();
            lastSnr = radio.getSNR();

            // Queue data downlink for processing in tick() (not ACKs)
            // Only queue if there's actual data (not just an ACK)
            if (downlinkLength > 0 && downlinkLength <= sizeof(downlinkBuffer)) {
                hasDownlink = true;
                downlinkPort = port;
            } else if (downlinkLength > sizeof(downlinkBuffer)) {
                LOGW("LoRaWAN", "Downlink too large (%d bytes), dropping", (int)downlinkLength);
            }

            // Re-apply configured data rate after downlink in case ADR changed it
            // This ensures our data rate matches our configuration, not what ADR requested
            if (configuredDataRate > 0) {
                node->setDatarate(configuredDataRate);
                currentDataRate = configuredDataRate;
                LOGD("LoRaWAN", "Data rate re-applied to DR%d after downlink (ADR may have changed it)",
                     configuredDataRate);
            }

            if (onTxDoneCb) onTxDoneCb();
            return true;
        } else {
            // Error occurred
            const char* errorMsg = getRadioLibErrorString(state);
            LOGW("LoRaWAN", "Confirmed sendReceive failed: %s (code %d)", errorMsg, state);
            
            // Enhanced error logging for packet too long
            if (state == RADIOLIB_ERR_PACKET_TOO_LONG) {
                uint8_t maxPayload = ::getMaxPayloadSize(lorawanRegion, currentDataRate);
                LOGW("LoRaWAN", "Packet too long: %d bytes, max for DR%d is %d bytes",
                     length, currentDataRate, maxPayload);
                LOGW("LoRaWAN", "Configured DR: %d, Cached DR: %d, Payload: %d bytes",
                     configuredDataRate, currentDataRate, length);
                LOGW("LoRaWAN", "Hint: Check if ADR changed data rate, or increase data rate/reduce payload");
            }
            
            if (onTxTimeoutCb) onTxTimeoutCb();
            return false;
        }
    } else {
        // For unconfirmed uplinks, use the simpler sendReceive overload (no downlink buffer)
        // RadioLib 7.x uses sendReceive for all uplinks
        state = node->sendReceive((uint8_t*)payload, length, port, false);
        
        if (state == RADIOLIB_ERR_NONE || state > 0) {
            // Success (positive values indicate downlink received, but we ignore it for unconfirmed)
            LOGD("LoRaWAN", "Unconfirmed uplink sent successfully");
            uplinkCount++;
            lastActivityMs = millis();
            if (onTxDoneCb) onTxDoneCb();
            return true;
        } else {
            const char* errorMsg = getRadioLibErrorString(state);
            LOGW("LoRaWAN", "Unconfirmed send failed: %s (code %d)", errorMsg, state);
            
            // Provide helpful hints for common errors
            if (state == RADIOLIB_ERR_PACKET_TOO_LONG) {
                uint8_t maxPayload = ::getMaxPayloadSize(lorawanRegion, currentDataRate);
                LOGW("LoRaWAN", "Packet too long: %d bytes, max for DR%d is %d bytes",
                     length, currentDataRate, maxPayload);
                LOGW("LoRaWAN", "Configured DR: %d, Cached DR: %d, Payload: %d bytes",
                     configuredDataRate, currentDataRate, length);
                LOGW("LoRaWAN", "Hint: Check if ADR changed data rate, or increase data rate/reduce payload");
            } else if (state == -28) {
                // Error -28 might be a LoRaWAN-specific error (e.g., not joined, invalid state)
                LOGW("LoRaWAN", "Hint: Error -28 may indicate node not ready. Ensure join completed successfully and wait a moment after joining.");
            }
            
            if (onTxTimeoutCb) onTxTimeoutCb();
            return false;
        }
    }
}

bool LoRaWANHal::isReadyForTx() const {
    return initialized && joined;
}

void LoRaWANHal::setOnDataReceived(OnDataReceived cb) {
    onDataCb = cb;
}

void LoRaWANHal::setOnTxDone(OnTxDone cb) {
    onTxDoneCb = cb;
}

void LoRaWANHal::setOnTxTimeout(OnTxTimeout cb) {
    onTxTimeoutCb = cb;
}

bool LoRaWANHal::isConnected() const {
    return connectionState == ConnectionState::Connected;
}

ILoRaWANHal::ConnectionState LoRaWANHal::getConnectionState() const {
    return connectionState;
}

int16_t LoRaWANHal::getLastRssiDbm() const {
    return lastRssiDbm;
}

int8_t LoRaWANHal::getLastSnr() const {
    return lastSnr;
}

void LoRaWANHal::setDeviceClass(uint8_t deviceClass) {
    // RadioLib handles device class internally
    LOGD("LoRaWAN", "Device class setting: %d (RadioLib uses Class A by default)", deviceClass);
}

void LoRaWANHal::setDataRate(uint8_t dataRate) {
    configuredDataRate = dataRate;  // Store for applying after join
    currentDataRate = dataRate;  // Update tracking
    if (node && joined) {
        // If already joined, apply immediately
        node->setDatarate(dataRate);
        LOGI("LoRaWAN", "Data rate set to %d (max payload: %d bytes)", dataRate, ::getMaxPayloadSize(lorawanRegion, dataRate));
    } else {
        LOGI("LoRaWAN", "Data rate %d configured (will apply after join)", dataRate);
    }
}

void LoRaWANHal::setTxPower(uint8_t txPower) {
    configuredTxPower = txPower;  // Store for applying after join
    if (node && joined) {
        // If already joined, apply immediately
        node->setTxPower(txPower);
        LOGI("LoRaWAN", "TX power set to %d dBm", txPower);
    } else {
        LOGI("LoRaWAN", "TX power %d dBm configured (will apply after join)", txPower);
    }
}

void LoRaWANHal::setAdr(bool enable) {
    if (node) {
        node->setADR(enable);
        LOGI("LoRaWAN", "ADR %s", enable ? "enabled" : "disabled");
    }
}

bool LoRaWANHal::isJoined() const {
    return initialized && joined;
}

void LoRaWANHal::join() {
    if (!initialized || !node) {
        LOGE("LoRaWAN", "Not initialized - call begin() first");
        return;
    }

    if (joined) {
        LOGI("LoRaWAN", "Already joined to network");
        return;
    }

    // Check if already connecting (prevent concurrent join attempts)
    if (connectionState == ConnectionState::Connecting) {
        LOGD("LoRaWAN", "Join already in progress");
        return;
    }

    LOGI("LoRaWAN", "Starting OTAA join process...");
    connectionState = ConnectionState::Connecting;
    lastJoinAttemptMs = millis();

    // Clear session before joining to ensure fresh DevNonce
    // This prevents "DevNonce has already been used" errors from ChirpStack
    // when the device reboots and tries to reuse a persisted DevNonce
    LOGI("LoRaWAN", "Clearing persisted session to ensure fresh DevNonce...");
    node->clearSession();

    // Attempt to activate (join) the network
    // This is a blocking call that may take several seconds (typically 5-15s)
    // RadioLib handles retries internally, but we track timeout
    // Note: We cleared the session above, so this will always create a new session
    uint32_t joinStartMs = millis();
    int16_t state = node->activateOTAA();
    uint32_t joinDurationMs = millis() - joinStartMs;

    if (state == RADIOLIB_LORAWAN_NEW_SESSION || state == RADIOLIB_LORAWAN_SESSION_RESTORED) {
        joined = true;
        connectionState = ConnectionState::Connected;
        const char* sessionType = (state == RADIOLIB_LORAWAN_NEW_SESSION) ? "new" : "restored";
        LOGI("LoRaWAN", "Successfully joined network (%s session, %lu ms)", sessionType, joinDurationMs);
        
        // Update RSSI/SNR from join process
        lastRssiDbm = radio.getRSSI();
        lastSnr = radio.getSNR();
        lastActivityMs = millis();
        
        // Small delay to ensure node is fully ready for transmission
        // This helps avoid error -28 (node not ready) when sending immediately after join
        delay(100);
        
        // Calculate minimum data rate for expected payload size
        // For now, use a conservative estimate (e.g., 30 bytes for telemetry)
        const uint8_t expectedPayloadSize = 30;  // Conservative estimate
        uint8_t minRequiredDR = ::getMinDataRateForPayload(lorawanRegion, expectedPayloadSize);
        
        // Determine final data rate to use
        // Use the higher of: configured data rate, minimum required for payload
        uint8_t finalDataRate = configuredDataRate;
        
        if (minRequiredDR != 255 && configuredDataRate < minRequiredDR) {
            LOGI("LoRaWAN", "Increasing data rate from %d to %d to support payload size %d",
                 configuredDataRate, minRequiredDR, expectedPayloadSize);
            finalDataRate = minRequiredDR;
        } else if (configuredDataRate == 0) {
            // No data rate configured, use minimum required
            if (minRequiredDR != 255) {
                finalDataRate = minRequiredDR;
                LOGI("LoRaWAN", "Setting data rate to %d to support payload size %d",
                     minRequiredDR, expectedPayloadSize);
            } else {
                // Fallback to DR1 if payload size calculation fails
                finalDataRate = 1;
                LOGW("LoRaWAN", "Could not determine min data rate, using DR1 as fallback");
            }
        }
        
        // Note: minDataRate from config is enforced in remote_app.cpp when calling setDataRate()
        
        // Apply data rate and TX power after join
        if (finalDataRate > 0) {
            node->setDatarate(finalDataRate);
            currentDataRate = finalDataRate;
            configuredDataRate = finalDataRate;  // Update configured to match actual
            uint8_t maxPayload = ::getMaxPayloadSize(lorawanRegion, finalDataRate);
            LOGI("LoRaWAN", "Data rate set to %d after join (max payload: %d bytes)", finalDataRate, maxPayload);
        }
        if (configuredTxPower > 0) {
            node->setTxPower(configuredTxPower);
            LOGI("LoRaWAN", "TX power set to %d dBm after join", configuredTxPower);
        }
    } else {
        joined = false;
        connectionState = ConnectionState::Disconnected;
        const char* errorMsg = getRadioLibErrorString(state);
        LOGW("LoRaWAN", "Join failed: %s (code %d, duration %lu ms)", errorMsg, state, joinDurationMs);
        
        // Provide helpful hints for common errors
        if (state == RADIOLIB_ERR_RX_TIMEOUT || state == -1116) {
            LOGW("LoRaWAN", "Hint: Check gateway is online, keys match ChirpStack, and DevNonces are flushed");
            // If join fails, clear session to force fresh DevNonce on next attempt
            // This helps recover from "DevNonce has already been used" errors
            LOGI("LoRaWAN", "Clearing session to force fresh join on next attempt...");
            node->clearSession();
        } else if (state == RADIOLIB_ERR_INVALID_FREQUENCY) {
            LOGW("LoRaWAN", "Hint: Verify region/sub-band configuration matches gateway");
        }
    }
}

void LoRaWANHal::forceReconnect() {
    if (!initialized || !node) return;

    LOGI("LoRaWAN", "Forcing reconnect...");
    joined = false;
    connectionState = ConnectionState::Disconnected;
    
    // Clear the persisted session to force a fresh join with new DevNonce
    // This prevents "DevNonce has already been used" errors from ChirpStack
    LOGI("LoRaWAN", "Clearing persisted session to force fresh join...");
    node->clearSession();
    
    join();
}

uint32_t LoRaWANHal::getUplinkCount() const {
    return uplinkCount;
}

uint32_t LoRaWANHal::getDownlinkCount() const {
    return downlinkCount;
}

void LoRaWANHal::resetCounters() {
    uplinkCount = 0;
    downlinkCount = 0;
    LOGI("LoRaWAN", "Counters reset");
}

const char* LoRaWANHal::getRegionName() const {
    // Return region name for debugging
    if (region == &US915) return "US915";
    if (region == &EU868) return "EU868";
    if (region == &AU915) return "AU915";
    if (region == &AS923) return "AS923";
    if (region == &IN865) return "IN865";
    if (region == &KR920) return "KR920";
    // CN779 region may not be available in all RadioLib versions
    // if (region == &CN779) return "CN779";
    if (region == &CN470) return "CN470";
    return "Unknown";
}

uint8_t LoRaWANHal::getSubBand() const {
    return subBand;
}

uint8_t LoRaWANHal::getCurrentDataRate() const {
    return currentDataRate;
}

uint8_t LoRaWANHal::getMaxPayloadSize() const {
    return ::getMaxPayloadSize(lorawanRegion, currentDataRate);
}
