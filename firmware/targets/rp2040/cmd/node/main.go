//go:build rp2040

// RP2040 (Pico W) sensor node firmware.
// Uses WiFi + HTTP transport to post telemetry to the same backend
// as the LoRa-E5 target. All sensor, rule, and settings logic is shared.
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
	rp2040flash "github.com/kisinga/farmon/firmware/targets/rp2040/pkg/flash"
	rp2040transport "github.com/kisinga/farmon/firmware/targets/rp2040/pkg/transport"
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
	active, activeFields, onChangeFields := initSensors(buses)
	acts := initActuators()

	println("[wifi] connecting to", cfg.WiFi.SSIDStr())
	stack, err := rp2040transport.SetupWiFi(cfg.WiFi.SSIDStr(), cfg.WiFi.PasswordStr())
	if err != nil {
		println("[wifi] setup failed:", err.Error())
		// Continue without transport — sensors still run, data buffered
		for {
			time.Sleep(time.Minute)
		}
	}
	println("[wifi] connected, DHCP done")
	tport := rp2040transport.New(stack, cfg.WiFi)

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
		Extension:      handleWiFiAirConfig,
		SaveFn:         saveSettings,
		RebootFn:       reboot,
		FWMajor:        1, FWMinor: 0, FWPatch: 0,
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
				// field is read for rules engine but never transmitted
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
