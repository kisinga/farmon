#pragma once

#include "lib/core_config.h"
#include "remote_sensor_config.h"

// =============================================================================
// LoRaWAN Credentials
// =============================================================================
// Get these from ChirpStack: Applications -> Your App -> Devices -> Your Device
//
// AppEUI/JoinEUI: Usually all zeros for ChirpStack v4
// AppKey: 16-byte key from device OTAA Keys tab

static const uint8_t LORAWAN_APP_EUI[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// TODO: Replace with your device's AppKey from ChirpStack
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
};

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
    // Region/sub-band compiled via heltec.sh FQBN options
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.subBand = 2;
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.defaultPort = 1;
    cfg.communication.lorawan.useConfirmedUplinks = false;
    
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
