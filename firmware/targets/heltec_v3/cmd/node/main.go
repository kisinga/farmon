//go:build esp32s3

// Heltec WiFi LoRa 32 V3 (ESP32-S3) sensor node firmware.
// Experimental target — uses WiFi + HTTP transport like the RP2040 target.
// LoRa (SX1262) support is not yet implemented.
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
	espflash "github.com/kisinga/farmon/firmware/targets/heltec_v3/pkg/flash"
	esptransport "github.com/kisinga/farmon/firmware/targets/heltec_v3/pkg/transport"
)

// Board pin table: PinMap index → physical GPIO on Heltec WiFi LoRa 32 V3.
// Avoids pins used by SX1262 (LoRa), SSD1306 (OLED), USB, and strapping.
var boardPins = [settings.MaxPins]machine.Pin{
	machine.GPIO1, machine.GPIO2, machine.GPIO3, machine.GPIO4,
	machine.GPIO5, machine.GPIO6, machine.GPIO7, machine.GPIO19,
	machine.GPIO20, machine.GPIO21, machine.GPIO26, machine.GPIO33,
	machine.GPIO34, machine.GPIO35, machine.GPIO36, machine.GPIO37,
	machine.GPIO38, machine.GPIO39, machine.GPIO40, machine.GPIO41,
}

// BusHardware for ESP32-S3: I2C0/I2C1 and UART0/UART1.
var busHW = sensors.BusHardware{
	I2C:  [2]*machine.I2C{machine.I2C0, machine.I2C1},
	UART: [2]*machine.UART{machine.UART0, machine.UART1},
}

var (
	store *sharedflash.Store
	cfg   esp32s3Config
)

func main() {
	store = sharedflash.New(espflash.ESP32S3Flash{}, esp32s3Magic)

	if data, ok := store.Load(settings.SettingsSize); ok {
		cfg = decodeSettings(data)
		println("[main] config loaded from flash")
	} else {
		cfg = defaultConfig()
		println("[main] using defaults (provision WiFi credentials first)")
	}

	buses := sensors.InitBuses(&cfg.Core, boardPins, busHW)
	registerDrivers()
	active, activeFields, onChangeFields := initSensors(buses)
	acts := initActuators()

	println("[wifi] connecting to", cfg.WiFi.SSIDStr())
	tport, err := esptransport.SetupAndConnect(cfg.WiFi)
	if err != nil {
		println("[wifi] setup failed:", err.Error())
		for {
			time.Sleep(time.Minute)
		}
	}
	println("[wifi] connected")

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
		activeFields = append(activeFields, 6)
	}

	n := node.New(node.Config{
		Core:           &cfg.Core,
		Transport:      tport,
		Actuators:      acts,
		Sensors:        active,
		ActiveFields:   activeFields,
		OnChangeFields: onChangeFields,
		Transfer:       fsm,
		Extension:      handleWiFiAirConfig,
		SaveFn:         saveSettings,
		RebootFn:       reboot,
		FWMajor:        0, FWMinor: 1, FWPatch: 0,
	})
	n.Run()
}

func handleWiFiAirConfig(data []byte) airconfig.Result {
	if len(data) >= 1 && data[0] == airconfig.AirCfgReset {
		cfg.WiFi = esptransport.WiFiSettings{}
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
			} else if slot.ReportOnChange() {
				onChangeFields = append(onChangeFields, uint8(idx))
			} else {
				activeFields = append(activeFields, uint8(idx))
			}
		}
		d := sensors.Create(slot, buses)
		if d == nil {
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
