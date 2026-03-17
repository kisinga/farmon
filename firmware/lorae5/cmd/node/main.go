// LoRa-E5 sensor node firmware.
// Flash once, configure everything via AirConfig (fPort 35) downlinks.
// No OTA firmware updates — pin maps, sensors, controls, rules, and
// LoRaWAN params are all runtime-configurable and persisted to flash.
package main

import (
	"encoding/binary"
	"math"
	"machine"
	"time"

	"github.com/farm/lorae5/pkg/airconfig"
	"github.com/farm/lorae5/pkg/flash"
	"github.com/farm/lorae5/pkg/protocol"
	"github.com/farm/lorae5/pkg/radio"
	"github.com/farm/lorae5/pkg/rules"
	"github.com/farm/lorae5/pkg/sensors"
	"github.com/farm/lorae5/pkg/settings"
)

// Board pin table: index in PinMap -> physical machine.Pin on LoRa-E5 dev kit.
var boardPins = [settings.MaxPins]machine.Pin{
	machine.PA0, machine.PA1, machine.PA2, machine.PA3,
	machine.PA4, machine.PA5, machine.PA6, machine.PA7,
	machine.PB0, machine.PB1, machine.PB2, machine.PB3,
	machine.PB4, machine.PB5, machine.PB6, machine.PB7,
	machine.PB8, machine.PB9, machine.PB10, machine.PB15,
}

var (
	store     *flash.Store
	cfg       settings.DeviceSettings
	eng       *rules.Engine
	rad       *radio.Radio
	buses     *sensors.BusRegistry
	active    []sensors.Driver
	txCount   uint32
	rxCount   uint32
	uptimeSec uint32
)

func main() {
	store = flash.New()
	if data, ok := store.Load(settings.SettingsSize); ok {
		cfg = decodeSettings(data)
		println("[main] config loaded from flash")
	} else {
		cfg = settings.ApplyPreset(settings.PresetWaterMonitor)
		println("[main] default preset: WaterMonitor")
	}

	buses = sensors.InitBuses(cfg)
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
	if cfg.RuleCount > 0 {
		eng.LoadRules(cfg.Rules[:cfg.RuleCount])
		println("[main] loaded", cfg.RuleCount, "rules")
	}

	rad = radio.New(radio.Config{
		AppEUI:     cfg.LoRaWAN.AppEUI,
		AppKey:     cfg.LoRaWAN.AppKey,
		Region:     regionString(cfg.LoRaWAN.Region),
		SubBand:    cfg.LoRaWAN.SubBand,
		DataRate:   cfg.LoRaWAN.DataRate,
		TxPower:    cfg.LoRaWAN.TxPower,
		ADREnabled: cfg.LoRaWAN.ADREnabled,
	})

	go rad.Run(machine.SPI3, newRadioControl())
	go sensorLoop()
	downlinkLoop()
}

// --- Sensor loop (goroutine) ---

func sensorLoop() {
	for {
		time.Sleep(time.Duration(cfg.TxIntervalSec) * time.Second)
		uptimeSec += uint32(cfg.TxIntervalSec)

		values := readAllSensors()
		nowMs := uint32(time.Now().UnixNano() / 1e6)
		// hourOfDay=-1 disables time windows until RTC sync is available.
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
				// Skip invalid readings — do not inject 0.0 which would
				// trigger any "field < threshold" rules falsely.
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
	tx := radio.TxMsg{Port: protocol.FPortTelemetry, Confirmed: cfg.LoRaWAN.Confirmed, Len: uint8(len(buf))}
	copy(tx.Payload[:], buf)
	select {
	case rad.TxChan <- tx:
		txCount++
	default:
	}
}

func sendStateChanges() {
	if !eng.HasPending() {
		return
	}
	var buf [protocol.MaxPayload]byte
	n, count := eng.FormatBatch(buf[:])
	if n > 0 {
		tx := radio.TxMsg{Port: protocol.FPortStateChange, Len: uint8(n)}
		copy(tx.Payload[:], buf[:n])
		select {
		case rad.TxChan <- tx:
			eng.ClearBatch(count)
		default:
		}
	}
}

// --- Downlink loop (main goroutine) ---

func downlinkLoop() {
	for rx := range rad.RxChan {
		rxCount++
		data := rx.Payload[:rx.Len]

		switch rx.Port {

		case protocol.FPortCmdReset:
			txCount = 0
			rxCount = 0
			for _, s := range active {
				if fs, ok := s.(*sensors.FlowSensor); ok {
					fs.SetTotalPulses(0)
				}
			}
			sendAck(rx.Port)

		case protocol.FPortCmdInterval:
			if rx.Len >= 2 {
				v := binary.LittleEndian.Uint16(data[:2])
				if v >= 10 && v <= 3600 {
					cfg.TxIntervalSec = v
					saveSettings()
				}
			}
			sendAck(rx.Port)

		case protocol.FPortCmdReboot:
			sendAck(rx.Port)
			reboot()

		case protocol.FPortDirectCtrl:
			if rx.Len >= 2 {
				nowMs := uint32(time.Now().UnixNano() / 1e6)
				eng.SetState(data[0], data[1], rules.TriggerDownlink, 0, nowMs)
				if rx.Len >= 6 {
					eng.SetManualOverride(data[0], binary.LittleEndian.Uint32(data[2:6]), nowMs)
				}
			}
			sendAck(rx.Port)

		case protocol.FPortRuleUpdate:
			if rx.Len == 1 && data[0] == 0xFF {
				cfg.RuleCount = 0
				eng.LoadRules(nil)
			} else if rx.Len >= 12 {
				var r settings.Rule
				if r.FromBinary(data) {
					upsertRule(&r)
					eng.LoadRules(cfg.Rules[:cfg.RuleCount])
				}
			}
			saveSettings()
			sendAck(rx.Port)

		// AirConfig: all device configuration on a single fPort
		case protocol.FPortAirConfig:
			result := airconfig.Handle(&cfg, data)
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

// --- Hardware init from pin map ---

type relayPin struct{ pin machine.Pin }

func (r *relayPin) Set(on bool) {
	if on {
		r.pin.High()
	} else {
		r.pin.Low()
	}
}

// registerDrivers populates the sensor factory registry. Called once at boot.
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
			funcCode = 0x03 // Read Holding Registers
		}
		dePin, hasDEPin := b.RS485DEPin(busIdx)
		signed := slot.Flags&0x04 != 0
		return sensors.NewModbusRTUDriver(b.UART[busIdx], dePin, hasDEPin,
			devAddr, funcCode, slot.Param2, signed, slot.FieldIndex)
	})
}

func initSensors() []sensors.Driver {
	var drivers []sensors.Driver
	// Track which field indices are in use to detect overlaps.
	var usedFields [64]bool
	for i := uint8(0); i < cfg.SensorCount; i++ {
		slot := cfg.Sensors[i]
		if !slot.Enabled() {
			continue
		}
		// Validate field index range and overlap.
		fc := sensors.FieldCount(slot.Type)
		collision := false
		for f := 0; f < fc; f++ {
			idx := int(slot.FieldIndex) + f
			if idx >= len(usedFields) || usedFields[idx] {
				println("[init] field index collision at", idx, "for sensor slot", i)
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
			println("[init] no driver for sensor type", slot.Type)
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
	for i := uint8(0); i < cfg.ControlCount; i++ {
		ctrl := cfg.Controls[i]
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
	for i := uint8(0); i < cfg.RuleCount; i++ {
		if cfg.Rules[i].ID == r.ID {
			cfg.Rules[i] = *r
			return
		}
	}
	if cfg.RuleCount < settings.MaxRules {
		cfg.Rules[cfg.RuleCount] = *r
		cfg.RuleCount++
	}
}

func saveSettings() {
	if err := store.Save(encodeSettings(cfg)); err != nil {
		println("[flash] save failed:", err.Error())
	}
}

func sendAck(port uint8) {
	tx := radio.TxMsg{Port: protocol.FPortCommandAck, Len: 1}
	tx.Payload[0] = port
	select {
	case rad.TxChan <- tx:
	default:
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
