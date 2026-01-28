// Remote Sensor Configuration
// Remote-specific sensor system configuration

#pragma once

#include <stdint.h>

// Remote Sensor Configuration
struct RemoteSensorConfig {
    bool enableSensorSystem = true;

    // --- Real Sensors ---
    struct {
        bool enabled = true; // Always on, provides core device status
    } batteryConfig;

    struct {
        bool enabled = true; // Enabled by default as it's our focus
    } waterFlowConfig; 

    // --- Pin Definitions ---
    struct {
        uint8_t waterFlow = 7; 
    } pins;
};
