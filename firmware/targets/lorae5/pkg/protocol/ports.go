// Package protocol defines the fPort constants and message formats.
// The same fPort namespace is used on both LoRaWAN and WiFi transports,
// keeping the backend decoder identical for all device types.
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
