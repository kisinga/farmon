//go:build rp2040

// RP2040 (Pico W) sensor node firmware.
// Uses WiFi + HTTP transport to post telemetry to the same backend
// as the LoRa-E5 target. All sensor, rule, and settings logic is shared.
package main

import (
	"machine"
	"time"

	"github.com/farm/firmware/pkg/airconfig"
	sharedflash "github.com/farm/firmware/pkg/flash"
	node "github.com/farm/firmware/pkg/node"
	"github.com/farm/firmware/pkg/sensors"
	"github.com/farm/firmware/pkg/settings"
	"github.com/farm/firmware/pkg/transfer"
	rp2040flash "github.com/farm/firmware/targets/rp2040/pkg/flash"
	rp2040transport "github.com/farm/firmware/targets/rp2040/pkg/transport"
	"tinygo.org/x/drivers/wifinina"
)

// Board pin table: PinMap index → physical GP pin on Raspberry Pi Pico W.
var boardPins = [settings.MaxPins]machine.Pin{
	machine.GP0, machine.GP1, machine.GP2, machine.GP3,
	machine.GP4, machine.GP5, machine.GP6, machine.GP7,
	machine.GP8, machine.GP9, machine.GP10, machine.GP11,
	machine.GP12, machine.GP13, machine.GP14, machine.GP15,
	machine.GP16, machine.GP17, machine.GP18, machine.GP19,
}

// BusHardware for RP2040: I2C0/I2C1 and UART0/UART1.
var busHW = sensors.BusHardware{
	I2C:  [2]*machine.I2C{machine.I2C0, machine.I2C1},
	UART: [2]*machine.UART{machine.UART0, machine.UART1},
}

var (
	store *sharedflash.Store
	cfg   rp2040Config
)

func main() {
	store = sharedflash.New(rp2040flash.RP2040Flash{}, rp2040Magic)

	if data, ok := store.Load(settings.SettingsSize); ok {
		cfg = decodeSettings(data)
		println("[main] config loaded from flash")
	} else {
		cfg = defaultConfig()
		println("[main] using defaults (provision WiFi credentials first)")
	}

	buses := sensors.InitBuses(cfg.Core, boardPins, busHW)
	registerDrivers()
	active := initSensors(buses)
	acts := initActuators()

	wifi := wifinina.New(machine.SPI0,
		machine.GP17, // CS
		machine.GP24, // ACK
		machine.GP25, // RST
		machine.GP29, // GPIO0 (WL_ON)
	)
	wifi.Configure()
	tport := rp2040transport.New(wifi, cfg.WiFi)

	// Build ReadLevel callback for the transfer FSM.
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

	n := node.New(node.Config{
		Core:      &cfg.Core,
		Transport: tport,
		Actuators: acts,
		Sensors:   active,
		Transfer:  fsm,
		Extension: handleWiFiAirConfig,
		SaveFn:    saveSettings,
		RebootFn:  reboot,
		FWMajor:   1, FWMinor: 0, FWPatch: 0,
	})
	n.Run()
}

// handleWiFiAirConfig handles the WiFi-specific AirConfig reset extension.
func handleWiFiAirConfig(data []byte) airconfig.Result {
	if len(data) >= 1 && data[0] == airconfig.AirCfgReset {
		cfg.WiFi = rp2040transport.WiFiSettings{}
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
}

func initSensors(buses *sensors.BusRegistry) []sensors.Driver {
	var drivers []sensors.Driver
	var usedFields [64]bool
	for i := uint8(0); i < cfg.Core.SensorCount; i++ {
		slot := cfg.Core.Sensors[i]
		if !slot.Enabled() {
			continue
		}
		fc := sensors.FieldCount(slot.Type)
		collision := false
		for f := 0; f < fc; f++ {
			idx := int(slot.FieldIndex) + f
			if idx >= len(usedFields) || usedFields[idx] {
				collision = true
				break
			}
		}
		if collision {
			continue
		}
		for f := 0; f < fc; f++ {
			usedFields[int(slot.FieldIndex)+f] = true
		}
		d := sensors.Create(slot, buses)
		if d == nil {
			continue
		}
		d.Begin()
		drivers = append(drivers, d)
	}
	println("[init]", len(drivers), "sensors active")
	return drivers
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
