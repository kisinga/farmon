// Communication Configuration - LoRaWAN settings (minimal for new radio task architecture)

#pragma once
#ifndef COMMUNICATION_CONFIG_H
#define COMMUNICATION_CONFIG_H

#include <stdint.h>

// LoRaWAN Region codes (kept for compatibility with device_config.h)
enum class LoRaWANRegion : uint8_t {
    EU868 = 0,
    US915 = 1,
    AU915 = 2,
    AS923 = 3,
    IN865 = 4,
    KR920 = 5
};

// LoRaWAN Configuration (minimal - radio task handles most of this internally)
struct LoRaWANConfig {
    bool enableLoRaWAN = true;         // Enable LoRaWAN communication
    
    // LoRaWAN keys (shared across fleet, DevEUI derived from chip ID)
    uint8_t appEui[8] = {0};           // Application EUI (shared across fleet)
    uint8_t appKey[16] = {0};          // Application Key (shared across fleet)
    
    // Regional settings (used by radio task at startup)
    LoRaWANRegion region = LoRaWANRegion::US915;  // LoRaWAN region
    uint8_t subBand = 2;               // Sub-band for US915/AU915 (1-8)
    
    // ADR and power settings (applied by radio task after join)
    bool adrEnabled = true;             // Adaptive Data Rate (obey network LinkADRReq)
    uint8_t txPower = 22;              // Transmit power (dBm)
    uint8_t dataRate = 3;              // Data rate (e.g. 3 = 222-byte max on US915)
    uint8_t minDataRate = 0;           // Clamp: data rate never below this (0 = no clamp)
    
    // Application settings
    uint8_t defaultPort = 1;           // Default application port for telemetry
    bool useConfirmedUplinks = true;   // Use confirmed uplinks by default
    
    // Timing
    uint32_t joinTimeoutMs = 30000;    // Per-attempt join timeout (RadioLib internal); retry delay is 10s in radio task
    uint32_t txIntervalMs = 60000;     // Interval between telemetry transmissions (persisted)
};

// Main Communication Configuration
struct CommunicationConfig {
    LoRaWANConfig lorawan;
};

#endif // COMMUNICATION_CONFIG_H
