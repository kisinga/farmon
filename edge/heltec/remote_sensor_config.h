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

    struct {
        bool enabled = false;
    } jsnSr04tWaterLevelConfig; // Replaces ultrasonic and waterLevel

    struct {
        bool enabled = false;
    } aht10TempHumidityConfig; // Replaces tempHumidity

    struct {
        bool enabled = false;
    } rs485Config;
    
    // --- Debug Sensors ---
    // Note: Debug sensors are now controlled by the globalDebugMode flag in CoreConfig,
    // not by a flag here. This section is for pin definitions.
    struct {
        // No config needed, it's just for random data
    } debugTemperatureConfig;


    // --- Pin Definitions ---
    struct {
        uint8_t waterFlow = 7; 
        uint8_t jsnSr04tTrig = 0;
        uint8_t jsnSr04tEcho = 0;
        uint8_t aht10Sda = 0; // I2C pins are often fixed, but can be defined
        uint8_t aht10Scl = 0;
        uint8_t rs485RE = 0;
        uint8_t rs485DE = 0;
    } pins;
};
