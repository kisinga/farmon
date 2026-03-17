// Package airconfig handles over-the-air device configuration via LoRaWAN downlinks.
// All device personality (pins, sensors, controls, presets) is changeable without reflashing.
// Pin/sensor/control changes require a reboot to take effect (same as Tasmota).
package airconfig

import (
	"encoding/binary"

	"github.com/farm/lorae5/pkg/protocol"
	"github.com/farm/lorae5/pkg/settings"
)

// Result tells the caller what to do after handling a downlink.
type Result uint8

const (
	ResultNone   Result = iota // no action needed
	ResultSaved                // settings saved, no reboot
	ResultReboot               // settings saved, reboot required
)

// Handle processes an AirConfig downlink (fPort 35).
// Mutates cfg in place. Caller is responsible for saving and rebooting.
func Handle(cfg *settings.DeviceSettings, data []byte) Result {
	if len(data) < 1 {
		return ResultNone
	}

	switch data[0] {

	case protocol.AirCfgPinMap:
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

	case protocol.AirCfgPreset:
		// [0x02, preset_id]
		if len(data) >= 2 {
			preset := settings.Preset(data[1])
			*cfg = settings.ApplyPreset(preset)
			println("[airconfig] preset", data[1], "applied")
			return ResultReboot
		}

	case protocol.AirCfgDump:
		// [0x03] — dump to serial for debugging
		println("[airconfig] --- Pin Map ---")
		for i := 0; i < settings.MaxPins; i++ {
			if cfg.PinMap[i] != settings.PinNone {
				println("  [", i, "]", settings.PinFunctionName(cfg.PinMap[i]))
			}
		}
		println("[airconfig] sensors:", cfg.SensorCount, "controls:", cfg.ControlCount, "rules:", cfg.RuleCount)
		return ResultNone

	case protocol.AirCfgSensor:
		// [0x04, slot, type, pin_idx, field_idx, flags, param1_lo, param1_hi, param2_lo, param2_hi]
		// Bytes 8-9 (param2) are optional for backward compatibility with V1 firmware senders.
		if len(data) >= 8 {
			slot := data[1]
			if int(slot) < settings.MaxSensors {
				p2 := uint16(0)
				if len(data) >= 10 {
					p2 = binary.LittleEndian.Uint16(data[8:10])
				}
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

	case protocol.AirCfgControl:
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

	case protocol.AirCfgLoRaWAN:
		// [0x06, region, subband, dr, txpwr, adr, confirmed]
		if len(data) >= 7 {
			cfg.LoRaWAN.Region = data[1]
			cfg.LoRaWAN.SubBand = data[2]
			cfg.LoRaWAN.DataRate = data[3]
			cfg.LoRaWAN.TxPower = data[4]
			cfg.LoRaWAN.ADREnabled = data[5] != 0
			cfg.LoRaWAN.Confirmed = data[6] != 0
			println("[airconfig] LoRaWAN config updated")
			return ResultReboot
		}

	case protocol.AirCfgReset:
		// [0xFF] — factory reset
		*cfg = settings.Defaults()
		println("[airconfig] factory reset")
		return ResultReboot
	}

	return ResultNone
}
