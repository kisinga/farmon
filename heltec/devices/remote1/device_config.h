#pragma once

#include "lib/core_config.h"
#include "lib/message_schema.h"
#include "lib/protocol_constants.h"
#include "remote_sensor_config.h"
#include "secrets.h"  // Device-specific secrets

// =============================================================================
// Device Configuration for remote1
// =============================================================================

// Device metadata
#define DEVICE_TYPE         "water_monitor"
#define FIRMWARE_VERSION    "2.0.0"

inline MessageSchema::Schema buildDeviceSchema() {
    return MessageSchema::SchemaBuilder(1)
        // Telemetry fields (sensor readings) — state_class for display/placement
        .addField("pd", "PulseDelta", "", MessageSchema::FieldType::UINT32, 0, 65535,
                  MessageSchema::FieldCategory::TELEMETRY, MessageSchema::FLAG_READABLE, MessageSchema::STATE_CLASS_DELTA)
        .addField("tv", "TotalVolume", "L", MessageSchema::FieldType::FLOAT, 0, 999999,
                  MessageSchema::FieldCategory::TELEMETRY, MessageSchema::FLAG_READABLE, MessageSchema::STATE_CLASS_TOTAL_INC)
        // System fields (device status/config) — mandatory bp, ec, tsr with state_class
        .addSystemField("bp", "Bat", "%", MessageSchema::FieldType::FLOAT, 0, 100, false, MessageSchema::STATE_CLASS_MEASUREMENT)
        .addSystemField("ec", "Err", "", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_TOTAL_INC)
        .addSystemField("tsr", "TimeRst", "s", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_DURATION)
        .addSystemField("tx", "TxInt", "s", MessageSchema::FieldType::UINT32,
                        10, 3600, true, MessageSchema::STATE_CLASS_MEASUREMENT)  // writable
        .addSystemField("ul", "UpCnt", "", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_MEASUREMENT)
        .addSystemField("dl", "DnCnt", "", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_MEASUREMENT)
        .addSystemField("up", "Up", "s", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_MEASUREMENT)
        .addSystemField("bc", "Boot", "", MessageSchema::FieldType::UINT32, 0, 4294967295, false, MessageSchema::STATE_CLASS_MEASUREMENT)
        // Controls
        .addControl("pump", "Water Pump", {"off", "on"})
        .addControl("valve", "Valve", {"closed", "open"})
        .build();
}

inline RemoteConfig buildDeviceConfig() {
    RemoteConfig cfg = RemoteConfig::create(3);
    cfg.deviceName = "remote-03";
    cfg.globalDebugMode = true;
    cfg.testModeEnabled = true;  // Set to false to use real sensor data

    // Battery monitoring (GPIO1 on Heltec V3)
    cfg.battery.adcPin = 1;

    // LoRaWAN settings
    // Region/sub-band set via heltec.sh FQBN options
    cfg.communication.lorawan.enableLoRaWAN = true;
    cfg.communication.lorawan.region = LoRaWANRegion::US915;
    cfg.communication.lorawan.subBand = 2;
    cfg.communication.lorawan.adrEnabled = true;
    cfg.communication.lorawan.defaultPort = FPORT_TELEMETRY;  // fPort 2 for JSON telemetry
    cfg.communication.lorawan.useConfirmedUplinks = true;

    memcpy(cfg.communication.lorawan.appEui, LORAWAN_APP_EUI, 8);
    memcpy(cfg.communication.lorawan.appKey, LORAWAN_APP_KEY, 16);

    return cfg;
}

inline RemoteSensorConfig buildDeviceSensorConfig() {
    RemoteSensorConfig cfg{};
    cfg.enableSensorSystem = true;
    return cfg;
}
