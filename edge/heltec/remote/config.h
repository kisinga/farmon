#pragma once

#include "lib/core_config.h"
#include "remote_sensor_config.h"

#define BATTERY_ADC_PIN 1

// ============================================================================
// LORAWAN CREDENTIALS (Shared across fleet)
// ============================================================================
// These should match the Application created in ChirpStack
// AppEUI (also called JoinEUI in LoRaWAN 1.1)
static const uint8_t LORAWAN_APP_EUI[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
};

// AppKey - shared secret for OTAA join (keep this secure!)
// TODO: Replace with actual key from ChirpStack
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
};

// ============================================================================
// DEVICE CONFIGURATION
// ============================================================================

// Per-device configuration for Remote
inline RemoteConfig buildRemoteConfig() {
    RemoteConfig cfg = RemoteConfig::create(3); // Device ID (used for display only)
    cfg.deviceName = "remote-03";
    cfg.globalDebugMode = true; // Enable debug mode for testing

    // Battery ADC pin for ESP32-S3 (Heltec V3): GPIO1
    cfg.battery.adcPin = BATTERY_ADC_PIN;

    // LoRaWAN configuration
    // Region/sub-band set in heltec.sh via FQBN board options (US915, sub-band 2)
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.subBand = 2;  // Sub-band 2 = channels 8-15 (903.9-905.3 MHz)
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.defaultPort = 1;  // Telemetry port
    cfg.communication.lorawan.useConfirmedUplinks = false;  // Unconfirmed for normal telemetry
    
    // Copy shared credentials
    memcpy(cfg.communication.lorawan.appEui, LORAWAN_APP_EUI, 8);
    memcpy(cfg.communication.lorawan.appKey, LORAWAN_APP_KEY, 16);

    // WiFi disabled for LoRaWAN remotes
    cfg.communication.wifi.enableWifi = false;

    return cfg;
}

inline RemoteSensorConfig buildRemoteSensorConfig() {
    RemoteSensorConfig cfg{};
    cfg.enableSensorSystem = true; 
    return cfg;
}


