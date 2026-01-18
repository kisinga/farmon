// Communication Configuration - Centralized configuration for all communication channels
// Consolidates USB, LoRa, WiFi, and routing configurations

#pragma once

#include <stdint.h>
#include "common_message_types.h"

// MQTT Configuration
struct MqttConfig {
    bool enableMqtt = false;            // Enable MQTT publishing over WiFi
    const char* brokerHost = nullptr;   // MQTT broker hostname or IP
    uint16_t brokerPort = 1883;         // MQTT broker port
    const char* clientId = nullptr;     // MQTT client ID
    const char* username = nullptr;     // Optional username
    const char* password = nullptr;     // Optional password
    const char* baseTopic = nullptr;    // Base topic for publishes
    const char* deviceTopic = nullptr;  // Optional device-specific topic (defaults to deviceId)
    uint8_t qos = 0;                    // QoS level (0/1)
    bool retain = false;                // Retain flag
    
    // Reliability settings
    uint32_t connectionTimeoutMs = 10000;    // Connection timeout
    uint32_t keepAliveMs = 30;               // Keep alive interval
    uint32_t retryIntervalMs = 5000;         // Base retry interval
    uint32_t maxRetryIntervalMs = 60000;     // Maximum retry interval (exponential backoff)
    uint8_t maxRetryAttempts = 10;           // Maximum retry attempts
    uint16_t maxQueueSize = 50;              // Maximum queued messages
    bool enableMessageQueue = true;          // Enable message queuing
};

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
    
    // Application settings
    uint8_t defaultPort = 1;           // Default application port for telemetry
    bool useConfirmedUplinks = false;  // Use confirmed uplinks by default
    
    // Timing
    uint32_t joinTimeoutMs = 30000;    // Join timeout
    uint32_t txIntervalMs = 60000;     // Minimum interval between transmissions
    
    // Device class
    uint8_t deviceClass = 0;           // 0=Class A, 1=Class B, 2=Class C
};

// WiFi Configuration
struct WifiCommConfig {
    bool enableWifi = false;           // Enable WiFi communication
    const char* ssid = nullptr;        // WiFi network name
    const char* password = nullptr;    // WiFi password
    uint32_t reconnectIntervalMs = 30000;    // Reconnect interval
    uint32_t statusCheckIntervalMs = 5000;   // Status check interval

    // Connection settings
    uint8_t maxReconnectAttempts = 10; // Maximum reconnect attempts
    bool enableDhcp = true;            // Enable DHCP
    const char* staticIp = nullptr;    // Static IP (if DHCP disabled)
    const char* subnetMask = nullptr;  // Subnet mask
    const char* gateway = nullptr;     // Gateway IP
    const char* dns = nullptr;         // DNS server

    // Advanced settings
    uint32_t connectionTimeoutMs = 15000; // Connection timeout
    bool enableAutoReconnect = true;   // Auto-reconnect on disconnect
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
        TransportType source;       // Set to LoRa, WiFi, etc.

        // Action
        TransportType destination; // Set to LoRa, WiFi, etc.
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
    WifiCommConfig wifi;
    ScreenConfig screen;
    MqttConfig mqtt;

    // Routing configuration
    RoutingConfig routing;

    // Global settings
    bool enableCommunicationManager = false; // Enable the communication manager
    uint32_t updateIntervalMs = 100;        // Communication manager update interval
    uint8_t maxConcurrentMessages = 8;      // Maximum concurrent messages
    bool enableMessageBuffering = true;     // Enable message buffering
    uint16_t bufferSize = 1024;             // Message buffer size (bytes)
};

