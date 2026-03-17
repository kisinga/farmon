// Package airconfig handles over-the-air device configuration.
// All core device personality (pins, sensors, controls, presets) is changeable
// without reflashing. Transport-specific config (LoRaWAN, WiFi) is handled
// via the ExtensionHandler hook so this package stays transport-agnostic.
package airconfig

import (
	"encoding/binary"

	"github.com/farm/firmware/pkg/settings"
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
			*cfg = settings.ApplyPreset(preset)
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
		return ResultNone

	case AirCfgSensor:
		// [0x04, slot, type, pin_idx, field_idx, flags, param1_lo, param1_hi, param2_lo, param2_hi]
		if len(data) >= 10 {
			slot := data[1]
			if int(slot) < settings.MaxSensors {
				p2 := binary.LittleEndian.Uint16(data[8:10])
				cfg.Sensors[slot] = settings.SensorSlot{
					Type:       settings.SensorType(data[2]),
					PinIndex:   data[3],
					FieldIndex: data[4],
					Flags:      data[5],
					Param1:     binary.LittleEndian.Uint16(data[6:8]),
					Param2:     p2,
				}
				if slot >= cfg.SensorCount {
					cfg.SensorCount = slot + 1
				}
				println("[airconfig] sensor slot", slot, "configured")
				return ResultReboot
			}
		}

	case AirCfgControl:
		// [0x05, slot, pin_idx, state_count, flags]
		if len(data) >= 5 {
			slot := data[1]
			if int(slot) < settings.MaxControls {
				cfg.Controls[slot] = settings.ControlSlot{
					PinIndex:   data[2],
					StateCount: data[3],
					Flags:      data[4],
				}
				if slot >= cfg.ControlCount {
					cfg.ControlCount = slot + 1
				}
				println("[airconfig] control slot", slot, "configured")
				return ResultReboot
			}
		}

	case AirCfgReset:
		// [0xFF] — factory reset (core only; transport config reset is caller's responsibility)
		*cfg = settings.Defaults()
		println("[airconfig] factory reset (core)")
		return ResultReboot
	}

	// Unknown command: delegate to transport-specific extension handler.
	if ext != nil {
		return ext(data)
	}
	return ResultNone
}

// AirConfig sub-command bytes (first byte of fPort 35 payload).
// These match the protocol constants so any package can use them without
// importing the protocol package.
const (
	AirCfgPinMap  = 0x01 // [0x01, idx, fn, idx, fn, ...]     set pin functions
	AirCfgPreset  = 0x02 // [0x02, preset_id]                  apply preset
	AirCfgDump    = 0x03 // [0x03]                              dump config to serial
	AirCfgSensor  = 0x04 // [0x04, slot, type, pin, field, flags, p1lo, p1hi, p2lo, p2hi]
	AirCfgControl = 0x05 // [0x05, slot, pin, state_count, flags]
	AirCfgLoRaWAN = 0x06 // [0x06, region, subband, dr, txpwr, adr, confirmed]  (LoRa-E5 only)
	AirCfgWiFi    = 0x07 // [0x07, ...]                         (RP2040 only, future)
	AirCfgReset   = 0xFF // [0xFF]                              factory reset settings
)
