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
// Message Protocol fPorts (Phase 4: Device-centric framework)
// =============================================================================
// fPort 1: Registration - Sent on boot/join, contains device metadata and field definitions
// fPort 2: Telemetry - Periodic sensor readings in JSON format
// fPort 3: State Change - Sent when control state changes (future: RS485 actuators)
// fPort 4: Command ACK - Acknowledgment of received downlink commands
// fPort 10-12: Utility commands (reset, interval, reboot) - kept for backward compatibility

// Uplink ports (device → server)
#define FPORT_REGISTRATION  1   // Device registration payload
#define FPORT_TELEMETRY     2   // Periodic sensor readings
#define FPORT_STATE_CHANGE  3   // Control state change events
#define FPORT_COMMAND_ACK   4   // Acknowledgment of downlink commands
#define FPORT_DIAGNOSTICS   6   // Device status/diagnostics response

// Downlink ports (server → device)
#define FPORT_REG_ACK       5   // Registration acknowledgment from server
#define FPORT_CMD_RESET     10  // Reset water volume + error count + counters
#define FPORT_CMD_INTERVAL  11  // Set reporting interval
#define FPORT_CMD_REBOOT    12  // Reboot device
#define FPORT_CMD_CLEAR_ERR 13  // Clear error count only
#define FPORT_CMD_FORCE_REG 14  // Force re-registration (clear NVS)
#define FPORT_CMD_STATUS    15  // Request device status uplink

// =============================================================================
// Registration State (NVS persistence)
// =============================================================================
#define REG_MAGIC           0xFAB10001  // Magic number to validate NVS data
#define CURRENT_REG_VERSION 1           // Increment when registration format changes

// =============================================================================
// Device Metadata (for registration message)
// =============================================================================
#define DEVICE_TYPE         "water_monitor"
#define FIRMWARE_VERSION    "2.0.0"

// =============================================================================
// Device Configuration
// =============================================================================

inline RemoteConfig buildRemoteConfig() {
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

inline RemoteSensorConfig buildRemoteSensorConfig() {
    RemoteSensorConfig cfg{};
    cfg.enableSensorSystem = true;
    return cfg;
}
