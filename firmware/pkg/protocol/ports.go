// Package protocol defines the fPort constants shared across all transports.
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

// AirConfig sub-command bytes (first byte of fPort 35 payload).
const (
	AirCfgPinMap   = 0x01 // [0x01, idx, fn, idx, fn, ...]
	AirCfgPreset   = 0x02 // [0x02, preset_id]
	AirCfgDump     = 0x03 // [0x03]
	AirCfgSensor   = 0x04 // [0x04, slot, type, pin, field, flags, p1lo, p1hi, p2lo, p2hi]
	AirCfgControl  = 0x05 // [0x05, slot, pin, state_count, flags, actuator_type, pin2_idx, pulse_x100ms]
	AirCfgLoRaWAN  = 0x06 // [0x06, region, subband, dr, txpwr, adr, confirmed]
	AirCfgWiFi     = 0x07 // [0x07, ...] (RP2040 only, future)
	AirCfgTransfer = 0x08 // [0x08, enabled, pump, valve_t1, valve_t2, sv, lvl_t1, lvl_t2, delta, t1min, pulse_sec]
	AirCfgSetHash  = 0x09 // [0x09, hash_b0, hash_b1, hash_b2, hash_b3] LE uint32 — commits config hash to flash
	AirCfgReset    = 0xFF // [0xFF]
)
