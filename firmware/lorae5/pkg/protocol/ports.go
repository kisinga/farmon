// Package protocol defines the LoRaWAN fPort constants and message formats.
// Must stay in sync with the backend and the original C++ protocol_constants.h.
package protocol

// Uplink ports (device -> server)
const (
	FPortRegistration = 1
	FPortTelemetry    = 2
	FPortStateChange  = 3
	FPortCommandAck   = 4
	FPortDiagnostics  = 6
	FPortReconnection = 7
)

// Downlink ports (server -> device)
const (
	FPortRegAck         = 5
	FPortCmdReset       = 10
	FPortCmdInterval    = 11
	FPortCmdReboot      = 12
	FPortCmdClearErr    = 13
	FPortCmdForceReg    = 14
	FPortCmdStatus      = 15
	FPortCmdDispTimeout = 16
	FPortDirectCtrl     = 20
	FPortRuleUpdate     = 30

	// AirConfig: over-the-air device configuration (pin map, sensors, controls, presets)
	FPortAirConfig = 35
)

const MaxPayload = 222 // DR3 US915

// AirConfig sub-commands (first byte of fPort 35 payload)
const (
	AirCfgPinMap  = 0x01 // [0x01, idx, fn, idx, fn, ...]     set pin functions
	AirCfgPreset  = 0x02 // [0x02, preset_id]                  apply preset
	AirCfgDump    = 0x03 // [0x03]                              dump config to serial
	AirCfgSensor  = 0x04 // [0x04, slot, type, pin, field, flags, p1lo, p1hi]
	AirCfgControl = 0x05 // [0x05, slot, pin, state_count, flags]
	AirCfgLoRaWAN = 0x06 // [0x06, region, subband, dr, txpwr, adr, confirmed]
	AirCfgReset   = 0xFF // [0xFF]                              factory reset settings
)
