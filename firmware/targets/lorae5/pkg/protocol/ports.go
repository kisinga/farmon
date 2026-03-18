// Package protocol re-exports from firmware/pkg/protocol for backward compatibility.
// Import firmware/pkg/protocol directly in new code.
package protocol

import shared "github.com/farm/firmware/pkg/protocol"

const (
	FPortRegistration = shared.FPortRegistration
	FPortTelemetry    = shared.FPortTelemetry
	FPortStateChange  = shared.FPortStateChange
	FPortCommandAck   = shared.FPortCommandAck
	FPortDiagnostics  = shared.FPortDiagnostics
	FPortReconnection = shared.FPortReconnection

	FPortRegAck         = shared.FPortRegAck
	FPortCmdReset       = shared.FPortCmdReset
	FPortCmdInterval    = shared.FPortCmdInterval
	FPortCmdReboot      = shared.FPortCmdReboot
	FPortCmdClearErr    = shared.FPortCmdClearErr
	FPortCmdForceReg    = shared.FPortCmdForceReg
	FPortCmdStatus      = shared.FPortCmdStatus
	FPortCmdDispTimeout = shared.FPortCmdDispTimeout
	FPortDirectCtrl     = shared.FPortDirectCtrl
	FPortRuleUpdate     = shared.FPortRuleUpdate
	FPortAirConfig      = shared.FPortAirConfig

	MaxPayload = shared.MaxPayload
)
