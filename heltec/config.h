#pragma once

#include "lib/core_config.h"
#include "remote_sensor_config.h"

// =============================================================================
// Credentials - Create secrets.h from secrets.example.h with your keys
// =============================================================================
#if __has_include("secrets.h")
    #include "secrets.h"
#else
    #error "Missing secrets.h - copy secrets.example.h to secrets.h and add your LoRaWAN credentials"
#endif

// =============================================================================
// Device Configuration
// =============================================================================

inline RemoteConfig buildRemoteConfig() {
    RemoteConfig cfg = RemoteConfig::create(3);
    cfg.deviceName = "remote-03";
    cfg.globalDebugMode = true;

    // Battery monitoring (GPIO1 on Heltec V3)
    cfg.battery.adcPin = 1;

    // LoRaWAN settings
    // Region/sub-band set via heltec.sh FQBN options
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.subBand = 2;
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.defaultPort = 1;
    cfg.communication.lorawan.useConfirmedUplinks = true;

    memcpy(cfg.communication.lorawan.appEui, LORAWAN_APP_EUI, 8);
    memcpy(cfg.communication.lorawan.appKey, LORAWAN_APP_KEY, 16);

    return cfg;
}

inline RemoteSensorConfig buildRemoteSensorConfig() {
    RemoteSensorConfig cfg{};
    cfg.enableSensorSystem = true;
    return cfg;
}
