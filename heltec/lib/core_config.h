// Core Configuration System - Remote device configuration
// Provides centralized configuration for LoRaWAN remote sensor nodes

#pragma once
#ifndef CORE_CONFIG_H
#define CORE_CONFIG_H

#include <stdint.h>
#include <string.h>
#include "communication_config.h"
#include "battery_monitor.h" // Include battery monitor for its config struct

// Device configuration for remote sensor nodes
struct DeviceConfig {
    uint8_t deviceId;
    const char* deviceName = "far-mon";
    uint32_t heartbeatIntervalMs;
    bool enableDisplay;
    uint32_t displayUpdateIntervalMs;
    bool globalDebugMode = false; // System-wide debug flag
    bool testModeEnabled = true;  // Generate random test data for dashboard testing

    // Centralized hardware and communication configuration
    BatteryMonitor::Config battery;
    CommunicationConfig communication;
};

// ============================================================================
// CONFIGURATION FACTORY
// ============================================================================

class DeviceConfigFactory {
public:
    // Common configuration defaults
    static constexpr uint32_t DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
    static constexpr uint32_t DEFAULT_DISPLAY_UPDATE_INTERVAL_MS = 1000;
    static constexpr uint32_t DEFAULT_ROUTING_INTERVAL_MS = 100;

    // Create remote configuration
    static DeviceConfig createRemoteConfig(uint8_t deviceId);

private:
    // Create base configuration
    static DeviceConfig createBaseConfig(uint8_t deviceId);
};

// ============================================================================
// REMOTE CONFIG STRUCTURE
// ============================================================================

// Remote configuration for LoRaWAN sensor nodes
struct RemoteConfig : DeviceConfig {
    RemoteConfig() = default;

    // Factory method
    static RemoteConfig create(uint8_t deviceId);
};

// ============================================================================
// LORAWAN UTILITY FUNCTIONS
// ============================================================================

// Derive DevEUI from ESP32 chip ID (eFuse MAC)
// The DevEUI is 8 bytes, derived from the 6-byte MAC by prepending 0xFF, 0xFE
void getDevEuiFromChipId(uint8_t* devEui);

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

inline RemoteConfig createRemoteConfig(uint8_t deviceId) {
    return RemoteConfig::create(deviceId);
}

#endif // CORE_CONFIG_H
