// Communication Configuration - Centralized configuration for all communication channels
// Consolidates USB, LoRaWAN, and routing configurations

#pragma once
#ifndef COMMUNICATION_CONFIG_H
#define COMMUNICATION_CONFIG_H

#include <stdint.h>
#include "common_message_types.h"

// USB Configuration
struct UsbConfig {
    bool enableDebug = true;           // Enable USB debug output
    uint32_t baudRate = 115200;        // Serial baud rate
    bool enableTimestamp = true;       // Include timestamps in debug output
    bool enableColorOutput = false;    // Enable ANSI color codes (if supported)
    uint8_t debugLevel = 3;            // Default debug level (0-5, higher = more verbose)
    bool verboseLogging = true;        // System-wide verbose logging toggle

    // Advanced settings
    uint16_t rxBufferSize = 256;       // Receive buffer size
    uint16_t txBufferSize = 256;       // Transmit buffer size
    bool enableFlowControl = false;    // Hardware flow control (RTS/CTS)
};

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
    uint8_t txPower = 14;              // Transmit power (dBm)
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

// Screen Configuration
struct ScreenConfig {
    bool enableScreen = false;         // Enable screen output
    uint32_t updateIntervalMs = 1000;  // Screen update interval
    uint8_t maxLines = 8;              // Maximum lines to display
    bool enableAutoScroll = true;      // Auto-scroll old messages
    bool enableTimestamp = true;       // Show timestamps
    uint16_t messageTimeoutMs = 5000;  // Message display timeout
};

// Routing Configuration
struct RoutingConfig {
    bool enableRouting = false;        // Enable message routing
    uint32_t routingIntervalMs = 100;  // Routing task interval

    // Route definitions
    struct RoutingRule {
        // Matcher
        Messaging::Message::Type messageType; // Set to Telemetry, Data, etc.
        TransportType source;       // Source transport type

        // Action
        TransportType destination; // Destination transport type
        bool enabled;                  // Route enabled
        uint8_t priority;              // Route priority (0=highest)
    };

    // Predefined routes
    RoutingRule routes[16];                  // Maximum 16 routes
    uint8_t routeCount = 0;            // Number of active routes
};

// Main Communication Configuration
struct CommunicationConfig {
    // Transport configurations
    UsbConfig usb;
    LoRaWANConfig lorawan;
    ScreenConfig screen;

    // Routing configuration
    RoutingConfig routing;

    // Global settings
    bool enableCommunicationManager = false; // Enable the communication manager
    uint32_t updateIntervalMs = 100;        // Communication manager update interval
    uint8_t maxConcurrentMessages = 8;      // Maximum concurrent messages
    bool enableMessageBuffering = true;     // Enable message buffering
    uint16_t bufferSize = 1024;             // Message buffer size (bytes)
};

#endif // COMMUNICATION_CONFIG_H

