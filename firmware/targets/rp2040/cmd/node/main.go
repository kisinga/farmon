//go:build rp2040

// RP2040 (Pico W) sensor node firmware.
// Uses WiFi + HTTP transport to post telemetry to the same backend
// as the LoRa-E5 target. All sensor, rule, and settings logic is shared.
package main

import (
	"encoding/binary"
	"machine"
	"math"
	"time"

	"github.com/farm/firmware/pkg/airconfig"
	sharedflash "github.com/farm/firmware/pkg/flash"
	"github.com/farm/firmware/pkg/rules"
	"github.com/farm/firmware/pkg/sensors"
	"github.com/farm/firmware/pkg/settings"
	"github.com/farm/firmware/pkg/transport"
	rp2040flash "github.com/farm/firmware/targets/rp2040/pkg/flash"
	rp2040transport "github.com/farm/firmware/targets/rp2040/pkg/transport"
	"tinygo.org/x/drivers/wifinina"
)

// fPort constants — same namespace as lorae5/protocol so the backend decoder
// handles both targets identically.
const (
	fPortTelemetry  = 2
	fPortStateChange = 3
	fPortCommandAck = 4
	fPortCmdReset   = 10
	fPortCmdInterval = 11
	fPortCmdReboot  = 12
	fPortDirectCtrl = 20
	fPortRuleUpdate = 30
	fPortAirConfig  = 35
	maxPayload      = 222
)

// Board pin table: PinMap index → physical GP pin on Raspberry Pi Pico W.
// GP0–GP27 are available; GP23/24/25/29 are used by the WiFi chip internally.
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
	store     *sharedflash.Store
	cfg       rp2040Config
	eng       *rules.Engine
	tport     transport.Transport
	buses     *sensors.BusRegistry
	active    []sensors.Driver
	txCount   uint32
	rxCount   uint32
	uptimeSec uint32
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

	buses = sensors.InitBuses(cfg.Core, boardPins, busHW)
	registerDrivers()
	active = initSensors()
	relays := initRelays()

	eng = rules.New(func(ctrlIdx, stateIdx uint8) bool {
		if int(ctrlIdx) >= len(relays) || relays[ctrlIdx] == nil {
			return true
		}
		relays[ctrlIdx].Set(stateIdx != 0)
		return true
	})
	if cfg.Core.RuleCount > 0 {
		eng.LoadRules(cfg.Core.Rules[:cfg.Core.RuleCount])
		println("[main] loaded", cfg.Core.RuleCount, "rules")
	}

	// Initialize WiFi chip (Pico W: CYW43 via SPI-like interface on dedicated pins)
	wifi := wifinina.New(machine.SPI0,
		machine.GP17, // CS
		machine.GP24, // ACK
		machine.GP25, // RST
		machine.GP29, // GPIO0 (boot select / WL_ON)
	)
	wifi.Configure()

	tport = rp2040transport.New(wifi, cfg.WiFi)

	go sensorLoop()
	downlinkLoop()
}

// --- Sensor loop (goroutine) ---

func sensorLoop() {
	for {
		time.Sleep(time.Duration(cfg.Core.TxIntervalSec) * time.Second)
		uptimeSec += uint32(cfg.Core.TxIntervalSec)

		values := readAllSensors()
		nowMs := uint32(time.Now().UnixNano() / 1e6)
		eng.Evaluate(values, eng.GetControlStates(), -1, nowMs)

		sendTelemetry(values)
		sendStateChanges()
	}
}

func readAllSensors() []float32 {
	var values []float32
	for _, s := range active {
		for _, r := range s.Read() {
			if !r.Valid {
				continue
			}
			for len(values) <= int(r.FieldIndex) {
				values = append(values, 0)
			}
			values[r.FieldIndex] = r.Value
		}
	}
	return values
}

func sendTelemetry(values []float32) {
	if len(values) == 0 {
		return
	}
	buf := make([]byte, 1+len(values)*5)
	buf[0] = uint8(len(values))
	for i, v := range values {
		off := 1 + i*5
		buf[off] = uint8(i)
		binary.LittleEndian.PutUint32(buf[off+1:], math.Float32bits(v))
	}
	var p transport.Packet
	p.Port = fPortTelemetry
	p.Len = uint8(len(buf))
	copy(p.Payload[:], buf)
	if tport.Send(p) {
		txCount++
	}
}

func sendStateChanges() {
	if !eng.HasPending() {
		return
	}
	var p transport.Packet
	p.Port = fPortStateChange
	n, count := eng.FormatBatch(p.Payload[:])
	if n > 0 {
		p.Len = uint8(n)
		if tport.Send(p) {
			eng.ClearBatch(count)
		}
	}
}

// --- Downlink/command loop (main goroutine) ---

func downlinkLoop() {
	for rx := range tport.RecvChan() {
		rxCount++
		data := rx.Payload[:rx.Len]

		switch rx.Port {

		case fPortCmdReset:
			txCount = 0
			rxCount = 0
			for _, s := range active {
				if fs, ok := s.(*sensors.FlowSensor); ok {
					fs.SetTotalPulses(0)
				}
			}
			sendAck(rx.Port)

		case fPortCmdInterval:
			if rx.Len >= 2 {
				v := binary.LittleEndian.Uint16(data[:2])
				if v >= 10 && v <= 3600 {
					cfg.Core.TxIntervalSec = v
					saveSettings()
				}
			}
			sendAck(rx.Port)

		case fPortCmdReboot:
			sendAck(rx.Port)
			reboot()

		case fPortDirectCtrl:
			if rx.Len >= 2 {
				nowMs := uint32(time.Now().UnixNano() / 1e6)
				eng.SetState(data[0], data[1], rules.TriggerDownlink, 0, nowMs)
				if rx.Len >= 6 {
					eng.SetManualOverride(data[0], binary.LittleEndian.Uint32(data[2:6]), nowMs)
				}
			}
			sendAck(rx.Port)

		case fPortRuleUpdate:
			if rx.Len == 1 && data[0] == 0xFF {
				cfg.Core.RuleCount = 0
				eng.LoadRules(nil)
			} else if rx.Len >= 12 {
				var r settings.Rule
				if r.FromBinary(data) {
					upsertRule(&r)
					eng.LoadRules(cfg.Core.Rules[:cfg.Core.RuleCount])
				}
			}
			saveSettings()
			sendAck(rx.Port)

		case fPortAirConfig:
			// RP2040 has no AirCfgLoRaWAN; no extension handler needed.
			result := airconfig.Handle(&cfg.Core, data, nil)
			if len(data) >= 1 && data[0] == airconfig.AirCfgReset {
				cfg.WiFi = rp2040transport.WiFiSettings{}
			}
			if result == airconfig.ResultSaved || result == airconfig.ResultReboot {
				saveSettings()
			}
			sendAck(rx.Port)
			if result == airconfig.ResultReboot {
				reboot()
			}
		}
	}
}

// --- Hardware init ---

type relayPin struct{ pin machine.Pin }

func (r *relayPin) Set(on bool) {
	if on {
		r.pin.High()
	} else {
		r.pin.Low()
	}
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

func initSensors() []sensors.Driver {
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

func initRelays() []*relayPin {
	relays := make([]*relayPin, settings.MaxControls)
	for i := uint8(0); i < cfg.Core.ControlCount; i++ {
		ctrl := cfg.Core.Controls[i]
		if !ctrl.Enabled() {
			continue
		}
		pin := boardPins[ctrl.PinIndex]
		pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
		pin.Low()
		relays[i] = &relayPin{pin: pin}
	}
	return relays
}

// --- Helpers ---

func upsertRule(r *settings.Rule) {
	for i := uint8(0); i < cfg.Core.RuleCount; i++ {
		if cfg.Core.Rules[i].ID == r.ID {
			cfg.Core.Rules[i] = *r
			return
		}
	}
	if cfg.Core.RuleCount < settings.MaxRules {
		cfg.Core.Rules[cfg.Core.RuleCount] = *r
		cfg.Core.RuleCount++
	}
}

func saveSettings() {
	if err := store.Save(encodeSettings(cfg)); err != nil {
		println("[flash] save failed:", err.Error())
	}
}

func sendAck(port uint8) {
	var p transport.Packet
	p.Port = fPortCommandAck
	p.Payload[0] = port
	p.Len = 1
	tport.Send(p)
}

func reboot() {
	time.Sleep(500 * time.Millisecond)
	machine.CPUReset()
}
