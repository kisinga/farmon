//go:build stm32wlx

// LoRa-E5 sensor node firmware.
// Flash once, configure everything via AirConfig (fPort 35) downlinks.
package main

import (
	"machine"
	"time"

	"github.com/kisinga/farmon/firmware/pkg/airconfig"
	sharedflash "github.com/kisinga/farmon/firmware/pkg/flash"
	node "github.com/kisinga/farmon/firmware/pkg/node"
	"github.com/kisinga/farmon/firmware/pkg/sensors"
	"github.com/kisinga/farmon/firmware/pkg/settings"
	"github.com/kisinga/farmon/firmware/pkg/transfer"
	lorae5flash "github.com/kisinga/farmon/firmware/targets/lorae5/pkg/flash"
	"github.com/kisinga/farmon/firmware/targets/lorae5/pkg/radio"
	loratransport "github.com/kisinga/farmon/firmware/targets/lorae5/pkg/transport"
)

// Board pin table: PinMap index → physical machine.Pin on LoRa-E5 dev kit.
var boardPins = [settings.MaxPins]machine.Pin{
	machine.PA0, machine.PA1, machine.PA2, machine.PA3,
	machine.PA4, machine.PA5, machine.PA6, machine.PA7,
	machine.PB0, machine.PB1, machine.PB2, machine.PB3,
	machine.PB4, machine.PB5, machine.PB6, machine.PB7,
	machine.PB8, machine.PB9, machine.PB10, machine.PB15,
}

// BusHardware for this target: STM32WL I2C and UART peripherals.
var busHW = sensors.BusHardware{
	I2C:  [2]*machine.I2C{machine.I2C0, nil},
	UART: [2]*machine.UART{machine.UART1, machine.UART2},
}

var (
	store *sharedflash.Store
	cfg   nodeConfig
)

func main() {
	store = sharedflash.New(lorae5flash.STM32WLFlash{}, loraeMagic)

	if data, ok := store.Load(settings.SettingsSize); ok {
		cfg = decodeSettings(data)
		println("[main] config loaded from flash")
	} else {
		cfg = defaultNodeConfig()
		println("[main] default preset: WaterMonitor")
		cfg.Core = settings.ApplyPreset(settings.PresetWaterMonitor)
	}

	buses := sensors.InitBuses(cfg.Core, boardPins, busHW)
	registerDrivers()
	active, activeFields, onChangeFields := initSensors(buses)
	acts := initActuators()

	rad := radio.New(radio.Config{
		AppEUI:     cfg.LoRaWAN.AppEUI,
		AppKey:     cfg.LoRaWAN.AppKey,
		Region:     regionString(cfg.LoRaWAN.Region),
		SubBand:    cfg.LoRaWAN.SubBand,
		DataRate:   cfg.LoRaWAN.DataRate,
		TxPower:    cfg.LoRaWAN.TxPower,
		ADREnabled: cfg.LoRaWAN.ADREnabled,
	})
	rad.Init(machine.SPI3, newRadioControl())
	tport := loratransport.New(rad, cfg.LoRaWAN.Confirmed)

	// Build ReadLevel callback for the transfer FSM using the pressure sensor field.
	readLevel := func() float32 {
		for _, s := range active {
			for _, r := range s.Read() {
				if r.Valid && r.FieldIndex == cfg.Core.Transfer.LevelT1FieldIdx {
					return r.Value
				}
			}
		}
		return 0
	}

	fsm := transfer.NewFromSettings(&cfg.Core.Transfer, acts, readLevel)
	if cfg.Core.Transfer.Enabled != 0 {
		activeFields = append(activeFields, 6) // transfer_state synthetic field
	}

	n := node.New(node.Config{
		Core:           &cfg.Core,
		Transport:      tport,
		Actuators:      acts,
		Sensors:        active,
		ActiveFields:   activeFields,
		OnChangeFields: onChangeFields,
		Transfer:       fsm,
		Extension:      handleLoRaWANAirConfig,
		SaveFn:         saveSettings,
		RebootFn:       reboot,
		FWMajor:        1, FWMinor: 0, FWPatch: 0,
	})
	n.Run()
}

// handleLoRaWANAirConfig is the ExtensionHandler for the LoRa-E5 target.
func handleLoRaWANAirConfig(data []byte) airconfig.Result {
	if len(data) < 1 {
		return airconfig.ResultNone
	}
	switch data[0] {
	case airconfig.AirCfgLoRaWAN:
		// [0x06, region, subband, dr, txpwr, adr, confirmed]
		if len(data) >= 7 {
			cfg.LoRaWAN.Region = data[1]
			cfg.LoRaWAN.SubBand = data[2]
			cfg.LoRaWAN.DataRate = data[3]
			cfg.LoRaWAN.TxPower = data[4]
			cfg.LoRaWAN.ADREnabled = data[5] != 0
			cfg.LoRaWAN.Confirmed = data[6] != 0
			println("[airconfig] LoRaWAN config updated")
			return airconfig.ResultReboot
		}
	case airconfig.AirCfgReset:
		cfg.LoRaWAN = settings.LoRaWANDefaults()
	}
	return airconfig.ResultNone
}

func initSensors(buses *sensors.BusRegistry) ([]sensors.Driver, []uint8, []uint8) {
	var drivers []sensors.Driver
	var activeFields []uint8
	var onChangeFields []uint8
	var usedFields [256]bool
	for i := uint8(0); i < cfg.Core.SensorCount; i++ {
		slot := cfg.Core.Sensors[i]
		if !slot.Enabled() {
			continue
		}
		fc := sensors.FieldCount(slot.Type)
		collision := false
		for f := 0; f < fc; f++ {
			idx := int(slot.FieldIndex) + f
			if usedFields[idx] {
				println("[init] field index collision at", idx, "for sensor slot", i)
				collision = true
				break
			}
		}
		if collision {
			continue
		}
		for f := 0; f < fc; f++ {
			idx := int(slot.FieldIndex) + f
			usedFields[idx] = true
			if slot.TelemetryDisabled() {
				// field is read for rules engine but never transmitted
			} else if slot.ReportOnChange() {
				onChangeFields = append(onChangeFields, uint8(idx))
			} else {
				activeFields = append(activeFields, uint8(idx))
			}
		}
		d := sensors.Create(slot, buses)
		if d == nil {
			println("[init] no driver for sensor type", slot.Type)
			continue
		}
		d.Begin()
		drivers = append(drivers, d)
	}
	println("[init]", len(drivers), "sensors active,", len(activeFields), "reported,", len(onChangeFields), "on_change")
	return drivers, activeFields, onChangeFields
}

func saveSettings() {
	if err := store.Save(encodeSettings(cfg)); err != nil {
		println("[flash] save failed:", err.Error())
	}
}

func reboot() {
	time.Sleep(500 * time.Millisecond)
	machine.CPUReset()
}

func regionString(r uint8) string {
	switch r {
	case 1:
		return "EU868"
	case 2:
		return "AU915"
	case 3:
		return "AS923"
	default:
		return "US915"
	}
}
