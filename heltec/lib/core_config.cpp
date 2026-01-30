#include "core_config.h"
#include <Arduino.h>

// ============================================================================
// LORAWAN UTILITY FUNCTIONS
// ============================================================================

void getDevEuiFromChipId(uint8_t* devEui) {
    // Get the 6-byte MAC address from the ESP32's eFuse
    uint64_t chipId = ESP.getEfuseMac();
    
    // Convert to DevEUI format (8 bytes)
    // Standard approach: insert 0xFF, 0xFE in the middle of the MAC
    // This creates a unique 8-byte EUI-64 from a 6-byte MAC
    devEui[0] = (chipId >> 0) & 0xFF;
    devEui[1] = (chipId >> 8) & 0xFF;
    devEui[2] = (chipId >> 16) & 0xFF;
    devEui[3] = 0xFF;
    devEui[4] = 0xFE;
    devEui[5] = (chipId >> 24) & 0xFF;
    devEui[6] = (chipId >> 32) & 0xFF;
    devEui[7] = (chipId >> 40) & 0xFF;
}

// ============================================================================
// RemoteConfig factory
// ============================================================================

RemoteConfig RemoteConfig::create(uint8_t deviceId) {
    RemoteConfig cfg{};
    cfg.deviceId = deviceId;

    cfg.heartbeatIntervalMs = DeviceConfigFactory::DEFAULT_HEARTBEAT_INTERVAL_MS;
    cfg.enableDisplay = true;
    cfg.displayUpdateIntervalMs = DeviceConfigFactory::DEFAULT_DISPLAY_UPDATE_INTERVAL_MS;

    cfg.communication = CommunicationConfig{};
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.txPower = 14;
    cfg.communication.lorawan.dataRate = 3;  // DR3 (SF7) for US915
    cfg.communication.lorawan.minDataRate = 1;  // US915
    cfg.communication.lorawan.defaultPort = 1;
    cfg.communication.lorawan.useConfirmedUplinks = true;
    cfg.communication.lorawan.joinTimeoutMs = 30000;
    cfg.communication.lorawan.txIntervalMs = 30000;
    cfg.communication.lorawan.deviceClass = 0;  // Class A

    // Remote-specific: faster display refresh
    cfg.displayUpdateIntervalMs = 200;

    return cfg;
}
