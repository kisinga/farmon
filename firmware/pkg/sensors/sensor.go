// Package sensors provides runtime-configurable sensor drivers.
// Drivers are compiled in and activated by settings (Tasmota pattern).
package sensors

import (
	"machine"
	"time"
)

// Reading is a single sensor measurement.
type Reading struct {
	FieldIndex uint8
	Value      float32
	Valid      bool
}

// Driver is the interface all sensor drivers implement.
type Driver interface {
	Begin()
	Read() []Reading
	Name() string
}

// --- YF-S201 Water Flow Sensor (interrupt-driven pulse counting) ---

type FlowSensor struct {
	pin            machine.Pin
	fieldIdx       uint8
	pulsesPerLiter uint16
	pulseCount     volatile32
	totalPulses    uint32
}

// volatile32 is a simple wrapper since TinyGo doesn't have atomic on all targets.
type volatile32 struct {
	val uint32
}

func NewFlowSensor(pin machine.Pin, fieldIdx uint8, pulsesPerLiter uint16) *FlowSensor {
	return &FlowSensor{
		pin:            pin,
		fieldIdx:       fieldIdx,
		pulsesPerLiter: pulsesPerLiter,
	}
}

func (f *FlowSensor) Begin() {
	f.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	f.pin.SetInterrupt(machine.PinFalling, func(p machine.Pin) {
		f.pulseCount.val++
	})
}

func (f *FlowSensor) Read() []Reading {
	// Grab and reset pulse count (disable interrupts briefly)
	count := f.pulseCount.val
	f.pulseCount.val = 0

	f.totalPulses += count
	volume := float32(f.totalPulses) / float32(f.pulsesPerLiter)

	return []Reading{
		{FieldIndex: f.fieldIdx, Value: float32(count), Valid: true},     // pulse delta
		{FieldIndex: f.fieldIdx + 1, Value: volume, Valid: true},         // total volume
	}
}

func (f *FlowSensor) Name() string            { return "YFS201" }
func (f *FlowSensor) TotalPulses() uint32      { return f.totalPulses }
func (f *FlowSensor) SetTotalPulses(v uint32)  { f.totalPulses = v }

// --- Battery ADC Sensor ---

type BatteryADC struct {
	pin      machine.Pin
	adc      machine.ADC
	fieldIdx uint8
}

func NewBatteryADC(pin machine.Pin, fieldIdx uint8) *BatteryADC {
	return &BatteryADC{pin: pin, fieldIdx: fieldIdx}
}

func (b *BatteryADC) Begin() {
	b.adc = machine.ADC{Pin: b.pin}
	b.adc.Configure(machine.ADCConfig{})
}

func (b *BatteryADC) Read() []Reading {
	raw := b.adc.Get()
	// Convert 16-bit ADC to voltage (3.3V ref, voltage divider 2:1)
	voltage := float32(raw) / 65535.0 * 3.3 * 2.0
	// Map voltage to percentage (3.0V-4.2V for LiPo)
	pct := (voltage - 3.0) / (4.2 - 3.0) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return []Reading{
		{FieldIndex: b.fieldIdx, Value: pct, Valid: true},
	}
}

func (b *BatteryADC) Name() string { return "BatteryADC" }

// --- DS18B20 Temperature Sensor (1-Wire, native bit-bang) ---
// Param1 lo byte = sensor index on bus (for multi-drop, 0 = first/only device).

type DS18B20Sensor struct {
	pin      machine.Pin
	fieldIdx uint8
}

func NewDS18B20Sensor(pin machine.Pin, fieldIdx uint8) *DS18B20Sensor {
	return &DS18B20Sensor{pin: pin, fieldIdx: fieldIdx}
}

func (d *DS18B20Sensor) Begin() {
	d.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
}

func (d *DS18B20Sensor) Read() []Reading {
	tempC, ok := ds18b20Read(d.pin)
	return []Reading{{FieldIndex: d.fieldIdx, Value: tempC, Valid: ok}}
}

func (d *DS18B20Sensor) Name() string { return "DS18B20" }

// ds18b20Read performs a single 1-Wire temperature conversion and read.
// Returns temperature in °C and validity flag.
func ds18b20Read(pin machine.Pin) (float32, bool) {
	if !owReset(pin) {
		return 0, false
	}
	owWriteByte(pin, 0xCC) // SKIP ROM (single device)
	owWriteByte(pin, 0x44) // CONVERT T
	time.Sleep(750 * time.Millisecond)

	if !owReset(pin) {
		return 0, false
	}
	owWriteByte(pin, 0xCC) // SKIP ROM
	owWriteByte(pin, 0xBE) // READ SCRATCHPAD

	lo := owReadByte(pin)
	hi := owReadByte(pin)

	raw := int16(uint16(hi)<<8 | uint16(lo))
	return float32(raw) / 16.0, true
}

func owReset(pin machine.Pin) bool {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	time.Sleep(480 * time.Microsecond)
	pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	time.Sleep(70 * time.Microsecond)
	present := !pin.Get()
	time.Sleep(410 * time.Microsecond)
	return present
}

func owWriteBit(pin machine.Pin, bit bool) {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	if bit {
		time.Sleep(6 * time.Microsecond)
		pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
		time.Sleep(64 * time.Microsecond)
	} else {
		time.Sleep(60 * time.Microsecond)
		pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
		time.Sleep(10 * time.Microsecond)
	}
}

func owReadBit(pin machine.Pin) bool {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	time.Sleep(3 * time.Microsecond)
	pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	time.Sleep(10 * time.Microsecond)
	bit := pin.Get()
	time.Sleep(53 * time.Microsecond)
	return bit
}

func owWriteByte(pin machine.Pin, b uint8) {
	for i := 0; i < 8; i++ {
		owWriteBit(pin, b&(1<<uint(i)) != 0)
	}
}

func owReadByte(pin machine.Pin) uint8 {
	var b uint8
	for i := 0; i < 8; i++ {
		if owReadBit(pin) {
			b |= 1 << uint(i)
		}
	}
	return b
}

// --- Soil Moisture ADC Sensor (capacitive, calibrated) ---
// Param1 = dryRaw (ADC count at dry, typically ~55000 on 16-bit)
// Param2 = wetRaw (ADC count at wet/water, typically ~18000)
// Output: 0–100% moisture (0 = bone dry, 100 = fully saturated)

type SoilADCSensor struct {
	adc      machine.ADC
	fieldIdx uint8
	dryRaw   uint16
	wetRaw   uint16
}

func NewSoilADCSensor(pin machine.Pin, fieldIdx uint8, dryRaw, wetRaw uint16) *SoilADCSensor {
	return &SoilADCSensor{
		adc:      machine.ADC{Pin: pin},
		fieldIdx: fieldIdx,
		dryRaw:   dryRaw,
		wetRaw:   wetRaw,
	}
}

func (s *SoilADCSensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *SoilADCSensor) Read() []Reading {
	raw := s.adc.Get()
	dry := float32(s.dryRaw)
	wet := float32(s.wetRaw)
	if dry <= wet {
		// Invalid calibration — return raw as percent of full scale
		return []Reading{{FieldIndex: s.fieldIdx, Value: float32(raw) / 65535.0 * 100.0, Valid: true}}
	}
	// Capacitive sensor: higher ADC = drier. Invert so 0%=dry, 100%=wet.
	pct := (dry - float32(raw)) / (dry - wet) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return []Reading{{FieldIndex: s.fieldIdx, Value: pct, Valid: true}}
}

func (s *SoilADCSensor) Name() string { return "SoilADC" }

// --- BME280 Environmental Sensor (I2C, native register access) ---
// PinIndex = I2C bus index; Param1 lo byte = I2C device address (e.g. 0x76).
// Outputs 3 readings at fieldIdx, fieldIdx+1, fieldIdx+2: temp(°C), humidity(%), pressure(hPa).

type BME280Sensor struct {
	bus      *machine.I2C
	addr     uint8
	fieldIdx uint8
	// Calibration trimming parameters loaded from device
	digT1          uint16
	digT2, digT3   int16
	digP1          uint16
	digP2          int16
	digP3          int16
	digP4          int16
	digP5          int16
	digP6          int16
	digP7          int16
	digP8          int16
	digP9          int16
	digH1          uint8
	digH2          int16
	digH3          uint8
	digH4, digH5   int16
	digH6          int8
	calibLoaded    bool
}

func NewBME280Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BME280Sensor {
	return &BME280Sensor{bus: bus, addr: addr, fieldIdx: fieldIdx}
}

func (b *BME280Sensor) Begin() {
	if b.bus == nil {
		return
	}
	// Set oversampling and mode: osrs_t x1, osrs_p x1, osrs_h x1, forced mode
	b.writeReg(0xF2, 0x01) // ctrl_hum: osrs_h x1
	b.writeReg(0xF4, 0x27) // ctrl_meas: osrs_t x1, osrs_p x1, normal mode
	b.writeReg(0xF5, 0x00) // config: no filter, 0.5ms standby
	b.loadCalib()
}

func (b *BME280Sensor) Read() []Reading {
	if b.bus == nil || !b.calibLoaded {
		return []Reading{
			{FieldIndex: b.fieldIdx, Valid: false},
			{FieldIndex: b.fieldIdx + 1, Valid: false},
			{FieldIndex: b.fieldIdx + 2, Valid: false},
		}
	}

	buf := make([]byte, 8)
	b.readRegs(0xF7, buf) // press_msb .. hum_lsb

	rawP := (int32(buf[0])<<12 | int32(buf[1])<<4 | int32(buf[2])>>4)
	rawT := (int32(buf[3])<<12 | int32(buf[4])<<4 | int32(buf[5])>>4)
	rawH := (int32(buf[6])<<8 | int32(buf[7]))

	tFine, tempC := b.compensateTemp(rawT)
	pressHPa := b.compensatePressure(rawP, tFine)
	humPct := b.compensateHumidity(rawH, tFine)

	return []Reading{
		{FieldIndex: b.fieldIdx, Value: tempC, Valid: true},
		{FieldIndex: b.fieldIdx + 1, Value: humPct, Valid: true},
		{FieldIndex: b.fieldIdx + 2, Value: pressHPa, Valid: true},
	}
}

func (b *BME280Sensor) Name() string { return "BME280" }

func (b *BME280Sensor) writeReg(reg, val uint8) {
	b.bus.WriteRegister(b.addr, reg, []byte{val})
}

func (b *BME280Sensor) readRegs(reg uint8, buf []byte) {
	b.bus.ReadRegister(b.addr, reg, buf)
}

func (b *BME280Sensor) loadCalib() {
	cb := make([]byte, 26)
	b.readRegs(0x88, cb)
	b.digT1 = uint16(cb[1])<<8 | uint16(cb[0])
	b.digT2 = int16(uint16(cb[3])<<8 | uint16(cb[2]))
	b.digT3 = int16(uint16(cb[5])<<8 | uint16(cb[4]))
	b.digP1 = uint16(cb[7])<<8 | uint16(cb[6])
	b.digP2 = int16(uint16(cb[9])<<8 | uint16(cb[8]))
	b.digP3 = int16(uint16(cb[11])<<8 | uint16(cb[10]))
	b.digP4 = int16(uint16(cb[13])<<8 | uint16(cb[12]))
	b.digP5 = int16(uint16(cb[15])<<8 | uint16(cb[14]))
	b.digP6 = int16(uint16(cb[17])<<8 | uint16(cb[16]))
	b.digP7 = int16(uint16(cb[19])<<8 | uint16(cb[18]))
	b.digP8 = int16(uint16(cb[21])<<8 | uint16(cb[20]))
	b.digP9 = int16(uint16(cb[23])<<8 | uint16(cb[22]))
	b.digH1 = cb[25]

	hb := make([]byte, 7)
	b.readRegs(0xE1, hb)
	b.digH2 = int16(uint16(hb[1])<<8 | uint16(hb[0]))
	b.digH3 = hb[2]
	b.digH4 = int16(uint16(hb[3])<<4 | uint16(hb[4]&0x0F))
	b.digH5 = int16(uint16(hb[5])<<4 | uint16(hb[4]>>4))
	b.digH6 = int8(hb[6])
	b.calibLoaded = true
}

func (b *BME280Sensor) compensateTemp(rawT int32) (int32, float32) {
	var1 := ((rawT>>3 - int32(b.digT1)<<1) * int32(b.digT2)) >> 11
	var2 := ((((rawT>>4 - int32(b.digT1)) * (rawT>>4 - int32(b.digT1))) >> 12) * int32(b.digT3)) >> 14
	tFine := var1 + var2
	return tFine, float32((tFine*5+128)>>8) / 100.0
}

func (b *BME280Sensor) compensatePressure(rawP, tFine int32) float32 {
	var1 := int64(tFine) - 128000
	var2 := var1 * var1 * int64(b.digP6)
	var2 += (var1 * int64(b.digP5)) << 17
	var2 += int64(b.digP4) << 35
	var1 = (var1*var1*int64(b.digP3))>>8 + (var1*int64(b.digP2))<<12
	var1 = (int64(1)<<47 + var1) * int64(b.digP1) >> 33
	if var1 == 0 {
		return 0
	}
	p := int64(1048576) - int64(rawP)
	p = ((p<<31 - var2) * 3125) / var1
	var1 = (int64(b.digP9) * (p >> 13) * (p >> 13)) >> 25
	var2 = (int64(b.digP8) * p) >> 19
	p = (p+var1+var2)>>8 + int64(b.digP7)<<4
	return float32(p) / 25600.0 // Pa → hPa
}

func (b *BME280Sensor) compensateHumidity(rawH, tFine int32) float32 {
	x := tFine - 76800
	x = (((rawH << 14) - int32(b.digH4)<<20 - int32(b.digH5)*x + 16384) >> 15) *
		(((((((x*int32(b.digH6))>>10)*
			(((x*int32(b.digH3))>>11)+32768))>>10)+2097152)*
			int32(b.digH2)+8192)>>14)
	x = x - (((((x>>15)*(x>>15))>>7)*int32(b.digH1))>>4)
	if x < 0 {
		x = 0
	}
	if x > 419430400 {
		x = 419430400
	}
	return float32(x>>12) / 1024.0
}

// --- INA219 Current/Voltage Sensor (I2C, native register access) ---
// PinIndex = I2C bus index; Param1 lo byte = I2C device address (e.g. 0x40).
// Outputs 3 readings at fieldIdx, fieldIdx+1, fieldIdx+2: voltage(V), current(A), power(W).

type INA219Sensor struct {
	bus      *machine.I2C
	addr     uint8
	fieldIdx uint8
}

func NewINA219Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *INA219Sensor {
	return &INA219Sensor{bus: bus, addr: addr, fieldIdx: fieldIdx}
}

func (s *INA219Sensor) Begin() {
	if s.bus == nil {
		return
	}
	// Config register: 32V range, ±320mV shunt, 12-bit ADC, continuous
	cfg := []byte{0x39, 0x9F}
	s.bus.WriteRegister(s.addr, 0x00, cfg)
}

func (s *INA219Sensor) Read() []Reading {
	if s.bus == nil {
		return []Reading{
			{FieldIndex: s.fieldIdx, Valid: false},
			{FieldIndex: s.fieldIdx + 1, Valid: false},
			{FieldIndex: s.fieldIdx + 2, Valid: false},
		}
	}
	buf := make([]byte, 2)

	// Bus voltage register (0x02): bits 15:3 = voltage in 4mV LSBs
	s.bus.ReadRegister(s.addr, 0x02, buf)
	busVoltage := float32(int16(uint16(buf[0])<<8|uint16(buf[1]))>>3) * 0.004

	// Shunt voltage register (0x01): LSB = 10µV
	s.bus.ReadRegister(s.addr, 0x01, buf)
	shuntUV := float32(int16(uint16(buf[0])<<8 | uint16(buf[1])))
	// Assuming 0.1Ω shunt: I = Vshunt / R
	currentA := (shuntUV * 0.00001) / 0.1

	powerW := busVoltage * currentA

	return []Reading{
		{FieldIndex: s.fieldIdx, Value: busVoltage, Valid: true},
		{FieldIndex: s.fieldIdx + 1, Value: currentA, Valid: true},
		{FieldIndex: s.fieldIdx + 2, Value: powerW, Valid: true},
	}
}

func (s *INA219Sensor) Name() string { return "INA219" }

// --- Generic Linear ADC Sensor ---
// Any sensor with a linear 0–VREF voltage output.
// Param1 = CalibOffset encoded as int16×10 (e.g. -400 → -40.0°C)
// Param2 = CalibSpan encoded as uint16×10  (e.g. 1650 → 165.0)
// output = offset + normalized_adc × span

type ADCLinearSensor struct {
	adc      machine.ADC
	fieldIdx uint8
	param1   uint16 // raw bits of int16 (offset × 10)
	param2   uint16 // span × 10
}

func NewADCLinearSensor(pin machine.Pin, fieldIdx uint8, param1, param2 uint16) *ADCLinearSensor {
	return &ADCLinearSensor{adc: machine.ADC{Pin: pin}, fieldIdx: fieldIdx, param1: param1, param2: param2}
}

func (s *ADCLinearSensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *ADCLinearSensor) Read() []Reading {
	raw := float32(s.adc.Get()) / 65535.0
	offset := float32(int16(s.param1)) / 10.0
	span := float32(s.param2) / 10.0
	return []Reading{{FieldIndex: s.fieldIdx, Value: offset + raw*span, Valid: true}}
}

func (s *ADCLinearSensor) Name() string { return "ADCLinear" }

// --- 4-20mA Current Loop Sensor ---
// Assumes a 250Ω burden resistor across ADC input: 4mA→1V, 20mA→5V (or proportional).
// Param1 = CalibOffset (int16×10), Param2 = CalibSpan (uint16×10).
// output = offset + ((raw_mA - 4) / 16) × span

type ADC4_20mASensor struct {
	adc      machine.ADC
	fieldIdx uint8
	param1   uint16
	param2   uint16
}

func NewADC4_20mASensor(pin machine.Pin, fieldIdx uint8, param1, param2 uint16) *ADC4_20mASensor {
	return &ADC4_20mASensor{adc: machine.ADC{Pin: pin}, fieldIdx: fieldIdx, param1: param1, param2: param2}
}

func (s *ADC4_20mASensor) Begin() {
	s.adc.Configure(machine.ADCConfig{})
}

func (s *ADC4_20mASensor) Read() []Reading {
	// ADC reads voltage across 250Ω shunt. At 3.3V reference:
	// 4mA  → 1.0V  → ADC = 1.0/3.3 * 65535 ≈ 19859
	// 20mA → 5.0V  → clamped; real measurement is relative
	// Normalize ADC linearly from 4mA point to 20mA point.
	rawADC := float32(s.adc.Get())
	// 4mA ≈ 19859 counts, 20mA ≈ 99295 counts (at 3.3V ref, 250Ω)
	const adc4mA float32 = 19859
	const adc20mA float32 = 99295
	normalized := (rawADC - adc4mA) / (adc20mA - adc4mA)
	if normalized < 0 {
		normalized = 0
	}
	if normalized > 1 {
		normalized = 1
	}
	offset := float32(int16(s.param1)) / 10.0
	span := float32(s.param2) / 10.0
	return []Reading{{FieldIndex: s.fieldIdx, Value: offset + normalized*span, Valid: true}}
}

func (s *ADC4_20mASensor) Name() string { return "ADC4_20mA" }

// --- Generic Pulse Counter Sensor ---
// Reuses FlowSensor interrupt infrastructure with configurable pulses-per-unit.
// Param1 = pulses per output unit (e.g. 100 for rain gauge at 0.01mm/pulse → mm).
// Outputs: pulse delta (fieldIdx), cumulative total (fieldIdx+1).

type PulseGenericSensor struct {
	pin           machine.Pin
	fieldIdx      uint8
	pulsesPerUnit uint16
	pulseCount    volatile32
	total         uint32
}

func NewPulseGenericSensor(pin machine.Pin, fieldIdx uint8, pulsesPerUnit uint16) *PulseGenericSensor {
	if pulsesPerUnit == 0 {
		pulsesPerUnit = 1
	}
	return &PulseGenericSensor{pin: pin, fieldIdx: fieldIdx, pulsesPerUnit: pulsesPerUnit}
}

func (p *PulseGenericSensor) Begin() {
	p.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	p.pin.SetInterrupt(machine.PinFalling, func(pp machine.Pin) {
		p.pulseCount.val++
	})
}

func (p *PulseGenericSensor) Read() []Reading {
	delta := p.pulseCount.val
	p.pulseCount.val = 0
	p.total += delta
	unitDelta := float32(delta) / float32(p.pulsesPerUnit)
	unitTotal := float32(p.total) / float32(p.pulsesPerUnit)
	return []Reading{
		{FieldIndex: p.fieldIdx, Value: unitDelta, Valid: true},
		{FieldIndex: p.fieldIdx + 1, Value: unitTotal, Valid: true},
	}
}

func (p *PulseGenericSensor) Name() string { return "PulseGeneric" }
