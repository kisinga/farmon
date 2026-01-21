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
// CONFIGURATION FACTORY IMPLEMENTATION
// ============================================================================

DeviceConfig DeviceConfigFactory::createBaseConfig(uint8_t deviceId) {
    DeviceConfig cfg{};
    cfg.deviceId = deviceId;

    // Set common defaults
    cfg.heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    cfg.enableDisplay = true;
    cfg.displayUpdateIntervalMs = DEFAULT_DISPLAY_UPDATE_INTERVAL_MS;

    // Initialize communication configuration with neutral defaults
    cfg.communication = CommunicationConfig{};

    // Apply common communication settings
    cfg.communication.enableCommunicationManager = false;
    cfg.communication.updateIntervalMs = DEFAULT_ROUTING_INTERVAL_MS;
    cfg.communication.maxConcurrentMessages = 8;
    cfg.communication.enableMessageBuffering = true;
    cfg.communication.bufferSize = 1024;

    // Apply LoRaWAN settings
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.txPower = 14;
    // Default data rate: DR3 (SF7) for US915, DR5 (SF7) for EU868
    // Note: DR5 on US915 is LR-FHSS which may not be supported, so use DR3 for US915
    cfg.communication.lorawan.dataRate = (cfg.communication.lorawan.region == LoRaWANRegion::US915) ? 3 : 5;
    // Minimum data rate: DR1 for US915 (supports 53 bytes), DR0 for EU868 (supports 51 bytes)
    cfg.communication.lorawan.minDataRate = (cfg.communication.lorawan.region == LoRaWANRegion::US915) ? 1 : 0;
    cfg.communication.lorawan.defaultPort = 1;
    cfg.communication.lorawan.useConfirmedUplinks = true;
    cfg.communication.lorawan.joinTimeoutMs = 30000;
    cfg.communication.lorawan.txIntervalMs = 30000;
    cfg.communication.lorawan.deviceClass = 0;  // Class A

    // Apply common USB settings
    cfg.communication.usb.enableDebug = true;
    cfg.communication.usb.baudRate = 115200;
    cfg.communication.usb.enableTimestamp = true;
    cfg.communication.usb.verboseLogging = true;
    cfg.communication.usb.rxBufferSize = 256;
    cfg.communication.usb.txBufferSize = 256;

    // Apply common screen settings
    cfg.communication.screen.maxLines = 8;
    cfg.communication.screen.enableAutoScroll = true;
    cfg.communication.screen.enableTimestamp = true;
    cfg.communication.screen.messageTimeoutMs = 5000;

    return cfg;
}

DeviceConfig DeviceConfigFactory::createRemoteConfig(uint8_t deviceId) {
    DeviceConfig cfg = createBaseConfig(deviceId);

    // Remote-specific settings
    cfg.displayUpdateIntervalMs = 200;

    // Set up routing rules for remote: Telemetry -> LoRaWAN
    cfg.communication.routing.enableRouting = true;
    cfg.communication.routing.routingIntervalMs = DEFAULT_ROUTING_INTERVAL_MS;

    // Add default routes (by transport type)
    cfg.communication.routing.routes[0] = {
        Messaging::Message::Type::Telemetry, 
        TransportType::Unknown, 
        TransportType::LoRaWAN, 
        true, 
        0
    };
    cfg.communication.routing.routeCount = 1;

    return cfg;
}

// RemoteConfig factory implementation
RemoteConfig RemoteConfig::create(uint8_t deviceId) {
    RemoteConfig cfg{};
    static_cast<DeviceConfig&>(cfg) = DeviceConfigFactory::createRemoteConfig(deviceId);
    cfg.deviceId = deviceId;

    // Set remote-specific defaults
    cfg.enableAnalogSensor = true;
    cfg.analogInputPin = 34;
    cfg.analogReadIntervalMs = 200;
    cfg.telemetryReportIntervalMs = 60000;
    cfg.debugTelemetryReportIntervalMs = 5000;
    cfg.analogReferenceVoltage = 3.30f;
    cfg.useCalibratedAdc = true;

    return cfg;
}
