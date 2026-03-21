// Package airconfig handles over-the-air device configuration.
// All core device personality (pins, sensors, controls, presets, transfer) is
// changeable without reflashing. Transport-specific config (LoRaWAN, WiFi) is
// handled via the ExtensionHandler hook so this package stays transport-agnostic.
package airconfig

import (
	"encoding/binary"

	"github.com/kisinga/farmon/firmware/pkg/settings"
	"github.com/kisinga/farmon/firmware/pkg/protocol"
)

// Re-export subcommand constants from protocol for callers that only import airconfig.
const (
	AirCfgPinMap   = protocol.AirCfgPinMap
	AirCfgPreset   = protocol.AirCfgPreset
	AirCfgDump     = protocol.AirCfgDump
	AirCfgSensor   = protocol.AirCfgSensor
	AirCfgControl  = protocol.AirCfgControl
	AirCfgLoRaWAN  = protocol.AirCfgLoRaWAN
	AirCfgWiFi     = protocol.AirCfgWiFi
	AirCfgTransfer = protocol.AirCfgTransfer
	AirCfgSetHash  = protocol.AirCfgSetHash
	AirCfgCompute  = protocol.AirCfgCompute
	AirCfgProbe    = protocol.AirCfgProbe
	AirCfgReset    = protocol.AirCfgReset
)

// Result tells the caller what to do after handling a command.
type Result uint8

const (
	ResultNone   Result = iota // no action needed
	ResultSaved                // settings changed, save to flash (no reboot needed)
	ResultReboot               // settings changed, save and reboot required
)

// ExtensionHandler handles transport-specific AirConfig sub-commands that the
// core package does not recognize. Called when Handle returns ResultNone.
// Return ResultNone if the command is also unrecognized by the extension.
type ExtensionHandler func(data []byte) Result

// Handle processes an AirConfig command payload (first byte is sub-command).
// Mutates cfg in place. Caller saves to flash and reboots as indicated by Result.
//
// If the sub-command is unrecognized by the core handler AND ext is non-nil,
// ext is called and its result is returned.
func Handle(cfg *settings.CoreSettings, data []byte, ext ExtensionHandler) Result {
	if len(data) < 1 {
		return ResultNone
	}

	switch data[0] {

	case AirCfgPinMap:
		// [0x01, idx, fn, idx, fn, ...]
		for i := 1; i+1 < len(data); i += 2 {
			idx := data[i]
			fn := settings.PinFunction(data[i+1])
			if int(idx) < settings.MaxPins && fn < settings.PinMax {
				cfg.PinMap[idx] = fn
				println("[airconfig] pin", idx, "->", fn)
			}
		}
		return ResultReboot

	case AirCfgPreset:
		// [0x02, preset_id]
		if len(data) >= 2 {
			preset := settings.Preset(data[1])
			settings.ApplyPresetTo(cfg, preset)
			println("[airconfig] preset", data[1], "applied")
			return ResultReboot
		}

	case AirCfgDump:
		// [0x03] — dump to serial for debugging
		println("[airconfig] --- Pin Map ---")
		for i := 0; i < settings.MaxPins; i++ {
			if cfg.PinMap[i] != settings.PinNone {
				println("  [", i, "]", settings.PinFunctionName(cfg.PinMap[i]))
			}
		}
		println("[airconfig] sensors:", cfg.SensorCount, "controls:", cfg.ControlCount, "rules:", cfg.RuleCount)
		println("[airconfig] transfer enabled:", cfg.Transfer.Enabled)
		return ResultNone

	case AirCfgSensor:
		// [0x04, slot, type, pin_idx, field_idx, flags, param1_lo, param1_hi, param2_lo, param2_hi]
		if len(data) >= 10 {
			slot := data[1]
			if int(slot) < settings.MaxSensors {
				cfg.Sensors[slot] = settings.SensorSlot{
					Type:       settings.SensorType(data[2]),
					PinIndex:   data[3],
					FieldIndex: data[4],
					Flags:      data[5],
					Param1:     binary.LittleEndian.Uint16(data[6:8]),
					Param2:     binary.LittleEndian.Uint16(data[8:10]),
				}
				if slot >= cfg.SensorCount {
					cfg.SensorCount = slot + 1
				}
				println("[airconfig] sensor slot", slot, "configured")
				return ResultReboot
			}
		}

	case AirCfgControl:
		// [0x05, slot, pin_idx, state_count, flags, actuator_type, pin2_idx, pulse_x100ms, field_index, value_max]
		if len(data) >= 8 {
			slot := data[1]
			if int(slot) < settings.MaxControls {
				cs := settings.ControlSlot{
					PinIndex:       data[2],
					StateCount:     data[3],
					Flags:          data[4],
					ActuatorType:   settings.ActuatorType(data[5]),
					Pin2Index:      data[6],
					PulseDurX100ms: data[7],
				}
				if len(data) >= 10 {
					cs.FieldIndex = data[8]
					cs.ValueMax = data[9]
				}
				cfg.Controls[slot] = cs
				if slot >= cfg.ControlCount {
					cfg.ControlCount = slot + 1
				}
				println("[airconfig] control slot", slot, "configured, field_idx=", cs.FieldIndex)
				return ResultReboot
			}
		}

	case AirCfgTransfer:
		// [0x08, enabled, pump_ctrl, valve_t1, valve_t2, sv_ctrl,
		//        level_t1_field, level_t2_field, start_delta_pct, stop_t1_min_pct, measure_pulse_sec]
		if len(data) >= 11 {
			cfg.Transfer.Enabled = data[1]
			cfg.Transfer.PumpCtrlIdx = data[2]
			cfg.Transfer.ValveT1CtrlIdx = data[3]
			cfg.Transfer.ValveT2CtrlIdx = data[4]
			cfg.Transfer.SVCtrlIdx = data[5]
			cfg.Transfer.LevelT1FieldIdx = data[6]
			cfg.Transfer.LevelT2FieldIdx = data[7]
			cfg.Transfer.StartDeltaPct = data[8]
			cfg.Transfer.StopT1MinPct = data[9]
			cfg.Transfer.MeasurePulseSec = data[10]
			println("[airconfig] transfer config updated, enabled:", data[1])
			return ResultSaved
		}

	case AirCfgCompute:
		// [0x0A, field_idx, bytecode_len, ...bytecode]
		if len(data) >= 3 {
			fieldIdx := data[1]
			bcLen := data[2]
			if int(bcLen) > settings.MaxBytecodeLen {
				bcLen = settings.MaxBytecodeLen
			}
			if len(data) >= 3+int(bcLen) && int(cfg.ComputeCount) < settings.MaxCompute {
				slot := cfg.ComputeCount
				cfg.Compute[slot].FieldIdx = fieldIdx
				cfg.Compute[slot].BytecodeLen = bcLen
				copy(cfg.Compute[slot].Bytecode[:bcLen], data[3:3+int(bcLen)])
				cfg.ComputeCount++
				println("[airconfig] compute field", fieldIdx, "bytecode len=", bcLen)
				return ResultSaved
			}
		}

	case AirCfgProbe:
		// [0x0B, field_idx_1, field_idx_2, ...] — handled by node.go via ProbeHandler callback.
		// The airconfig package sets a flag; the node loop sends the response.
		// This is a no-op here — the node's ext handler should process this.
		// Fall through to ext handler.

	case AirCfgSetHash:
		// [0x09, b0, b1, b2, b3] — backend commits the expected config hash after a full push.
		// Firmware stores it and reports it in checkin (fPort 1) so the backend can detect drift.
		if len(data) >= 5 {
			cfg.ConfigHash = binary.LittleEndian.Uint32(data[1:5])
			println("[airconfig] config hash committed")
			return ResultSaved
		}

	case AirCfgReset:
		// [0xFF] — factory reset (core only; transport config reset is caller's responsibility)
		settings.ResetDefaults(cfg)
		println("[airconfig] factory reset (core)")
		return ResultReboot
	}

	// Unknown command: delegate to transport-specific extension handler.
	if ext != nil {
		return ext(data)
	}
	return ResultNone
}
