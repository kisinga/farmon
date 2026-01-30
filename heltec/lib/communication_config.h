// Communication Configuration - LoRaWAN and minimal transport settings

#pragma once
#ifndef COMMUNICATION_CONFIG_H
#define COMMUNICATION_CONFIG_H

#include <stdint.h>

// LoRaWAN Region codes
enum class LoRaWANRegion : uint8_t {
    EU868 = 0,
    US915 = 1,
    AU915 = 2,
    AS923 = 3,
    IN865 = 4,
    KR920 = 5
};

// LoRaWAN Configuration
struct LoRaWANConfig {
    bool enableLoRaWAN = true;         // Enable LoRaWAN communication
    
    // LoRaWAN keys (shared across fleet, DevEUI derived from chip ID)
    uint8_t appEui[8] = {0};           // Application EUI (shared across fleet)
    uint8_t appKey[16] = {0};          // Application Key (shared across fleet)
    
    // Regional settings
    LoRaWANRegion region = LoRaWANRegion::US915;  // LoRaWAN region
    uint8_t subBand = 2;               // Sub-band for US915/AU915 (1-8, set in build flags)
    
    // ADR and power settings
    bool adrEnabled = true;            // Adaptive Data Rate
    uint8_t txPower = 22;              // Transmit power (dBm)
    uint8_t dataRate = 5;              // Default data rate (SF7 on EU868)
    uint8_t minDataRate = 1;           // Minimum data rate (prevents ADR from going too low)
    
    // Application settings
    uint8_t defaultPort = 1;           // Default application port for telemetry
    bool useConfirmedUplinks = true;   // Use confirmed uplinks by default
    
    // Timing
    uint32_t joinTimeoutMs = 30000;    // Join timeout
    uint32_t txIntervalMs = 30000;     // Minimum interval between transmissions
    
    // Device class
    uint8_t deviceClass = 0;           // 0=Class A, 1=Class B, 2=Class C
};

// Main Communication Configuration (LoRaWAN-focused)
struct CommunicationConfig {
    LoRaWANConfig lorawan;
};

#endif // COMMUNICATION_CONFIG_H

