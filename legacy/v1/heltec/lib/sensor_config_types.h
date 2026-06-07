// Sensor-defined config structs for composition.
// Devices supply values; sensor implementations in lib use these shapes.

#pragma once
#ifndef SENSOR_CONFIG_TYPES_H
#define SENSOR_CONFIG_TYPES_H

#include <stdint.h>

namespace SensorConfig {

struct YFS201WaterFlow {
    uint8_t pin = 7;
    bool enabled = true;
    const char* persistence_namespace = "water_meter";
};

struct BatteryMonitor {
    bool enabled = true;
};

} // namespace SensorConfig

#endif // SENSOR_CONFIG_TYPES_H
