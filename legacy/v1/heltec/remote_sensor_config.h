// Remote Sensor Configuration
// Device-facing aggregate of sensor-defined config structs (from lib).
// Device supplies values in buildDeviceSensorConfig().

#pragma once

#include "lib/sensor_config_types.h"

struct RemoteSensorConfig {
    bool enableSensorSystem = true;

    SensorConfig::YFS201WaterFlow waterFlow;
    SensorConfig::BatteryMonitor battery;
};
