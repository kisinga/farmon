//go:build stm32wlx

// LoRa-E5 sensor node firmware.
// Flash once, configure everything via AirConfig (fPort 35) downlinks.
package main

import (
	"machine"
	"time"

	"github.com/farmon/firmware/pkg/airconfig"
	sharedflash "github.com/farmon/firmware/pkg/flash"
	node "github.com/farmon/firmware/pkg/node"
	"github.com/farmon/firmware/pkg/sensors"
	"github.com/farmon/firmware/pkg/settings"
	"github.com/farmon/firmware/pkg/transfer"
	lorae5flash "github.com/farmon/firmware/targets/lorae5/pkg/flash"
	"github.com/farmon/firmware/targets/lorae5/pkg/radio"
	loratransport "github.com/farmon/firmware/targets/lorae5/pkg/transport"
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
	I2C:  [2]*machine.I2C{machine.I2C0, machine.I2C1},
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
	go rad.Run(machine.SPI3, newRadioControl())
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

func registerDrivers() {
	sensors.Register(settings.SensorFlowYFS201, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		ppl := slot.Param1
		if ppl == 0 {
			ppl = 450
		}
		return sensors.NewFlowSensor(boardPins[slot.PinIndex], slot.FieldIndex, ppl)
	})
	sensors.Register(settings.SensorBatteryADC, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewBatteryADC(boardPins[slot.PinIndex], slot.FieldIndex)
	})
	sensors.Register(settings.SensorDS18B20, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewDS18B20Sensor(boardPins[slot.PinIndex], slot.FieldIndex)
	})
	sensors.Register(settings.SensorSoilADC, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		dryRaw := slot.Param1
		wetRaw := slot.Param2
		if dryRaw == 0 {
			dryRaw = 55000
		}
		if wetRaw == 0 {
			wetRaw = 18000
		}
		return sensors.NewSoilADCSensor(boardPins[slot.PinIndex], slot.FieldIndex, dryRaw, wetRaw)
	})
	sensors.Register(settings.SensorBME280, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		busIdx := int(slot.PinIndex)
		if busIdx >= 2 || b.I2C[busIdx] == nil {
			println("[init] BME280: invalid I2C bus index", busIdx)
			return nil
		}
		addr := uint8(slot.Param1 & 0xFF)
		if addr == 0 {
			addr = 0x76
		}
		return sensors.NewBME280Sensor(b.I2C[busIdx], addr, slot.FieldIndex)
	})
	sensors.Register(settings.SensorINA219, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		busIdx := int(slot.PinIndex)
		if busIdx >= 2 || b.I2C[busIdx] == nil {
			println("[init] INA219: invalid I2C bus index", busIdx)
			return nil
		}
		addr := uint8(slot.Param1 & 0xFF)
		if addr == 0 {
			addr = 0x40
		}
		return sensors.NewINA219Sensor(b.I2C[busIdx], addr, slot.FieldIndex)
	})
	sensors.Register(settings.SensorADCLinear, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewADCLinearSensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1, slot.Param2)
	})
	sensors.Register(settings.SensorADC4_20mA, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewADC4_20mASensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1, slot.Param2)
	})
	sensors.Register(settings.SensorPulseGeneric, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		ppu := slot.Param1
		if ppu == 0 {
			ppu = 1
		}
		return sensors.NewPulseGenericSensor(boardPins[slot.PinIndex], slot.FieldIndex, ppu)
	})
	sensors.Register(settings.SensorModbusRTU, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		busIdx := int(slot.PinIndex)
		if busIdx >= 2 || b.UART[busIdx] == nil {
			println("[init] ModbusRTU: invalid UART bus index", busIdx)
			return nil
		}
		devAddr := uint8(slot.Param1 & 0xFF)
		funcCode := uint8(slot.Param1 >> 8)
		if funcCode == 0 {
			funcCode = 0x03
		}
		dePin, hasDEPin := b.RS485DEPin(busIdx)
		signed := slot.Flags&0x04 != 0
		return sensors.NewModbusRTUDriver(b.UART[busIdx], dePin, hasDEPin,
			devAddr, funcCode, slot.Param2, signed, slot.FieldIndex)
	})
	sensors.Register(settings.SensorDigitalIn, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewDigitalInSensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1)
	})
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
