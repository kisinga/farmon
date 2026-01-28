#pragma once

// =============================================================================
// Message Protocol fPorts (Phase 4: Device-centric framework)
// =============================================================================
// fPort 1: Registration - Sent on boot/join, contains device metadata and field definitions
// fPort 2: Telemetry - Periodic sensor readings in JSON format
// fPort 3: State Change - Sent when control state changes (future: RS485 actuators)
// fPort 4: Command ACK - Acknowledgment of received downlink commands
// fPort 10-12: Utility commands (reset, interval, reboot)

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
#define FPORT_CMD_DISPLAY_TIMEOUT 16  // Set display auto-off timeout (2 bytes: seconds big-endian)

// Edge Rules Engine ports
#define FPORT_DIRECT_CTRL   20  // Direct control command (7 bytes: ctrl_idx, state_idx, flags, timeout)
#define FPORT_RULE_UPDATE   30  // Rule management (12 bytes per rule, or special commands)

// =============================================================================
// Registration State (NVS persistence)
// =============================================================================
#define REG_MAGIC           0xFAB10001  // Magic number to validate NVS data
#define CURRENT_REG_VERSION 1           // Increment when registration format changes
