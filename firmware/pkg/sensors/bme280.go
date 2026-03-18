package sensors

import "machine"

// BME280Sensor reads temperature, humidity, and pressure via I2C.
// PinIndex = I2C bus index; Param1 lo byte = I2C device address (default 0x76).
// Outputs 3 readings at fieldIdx, fieldIdx+1, fieldIdx+2: temp(°C), humidity(%RH), pressure(hPa).

type BME280Sensor struct {
	bus      *machine.I2C
	addr     uint8
	fieldIdx uint8
	// Bosch compensation trimming parameters loaded once in Begin()
	digT1                        uint16
	digT2, digT3                 int16
	digP1                        uint16
	digP2, digP3, digP4, digP5   int16
	digP6, digP7, digP8, digP9   int16
	digH1                        uint8
	digH2                        int16
	digH3                        uint8
	digH4, digH5                 int16
	digH6                        int8
	calibLoaded                  bool
}

func NewBME280Sensor(bus *machine.I2C, addr uint8, fieldIdx uint8) *BME280Sensor {
	return &BME280Sensor{bus: bus, addr: addr, fieldIdx: fieldIdx}
}

func (b *BME280Sensor) Begin() {
	if b.bus == nil {
		return
	}
	b.writeReg(0xF2, 0x01) // ctrl_hum:  osrs_h ×1
	b.writeReg(0xF4, 0x27) // ctrl_meas: osrs_t ×1, osrs_p ×1, normal mode
	b.writeReg(0xF5, 0x00) // config:    no filter, 0.5 ms standby
	b.loadCalib()
}

func (b *BME280Sensor) Read() []Reading {
	invalid := []Reading{
		{FieldIndex: b.fieldIdx, Valid: false},
		{FieldIndex: b.fieldIdx + 1, Valid: false},
		{FieldIndex: b.fieldIdx + 2, Valid: false},
	}
	if b.bus == nil || !b.calibLoaded {
		return invalid
	}

	buf := make([]byte, 8)
	b.readRegs(0xF7, buf) // press_msb … hum_lsb

	rawP := int32(buf[0])<<12 | int32(buf[1])<<4 | int32(buf[2])>>4
	rawT := int32(buf[3])<<12 | int32(buf[4])<<4 | int32(buf[5])>>4
	rawH := int32(buf[6])<<8 | int32(buf[7])

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

func (b *BME280Sensor) compensateTemp(rawT int32) (tFine int32, tempC float32) {
	v1 := ((rawT>>3 - int32(b.digT1)<<1) * int32(b.digT2)) >> 11
	v2 := ((((rawT>>4 - int32(b.digT1)) * (rawT>>4 - int32(b.digT1))) >> 12) * int32(b.digT3)) >> 14
	tFine = v1 + v2
	return tFine, float32((tFine*5+128)>>8) / 100.0
}

func (b *BME280Sensor) compensatePressure(rawP, tFine int32) float32 {
	v1 := int64(tFine) - 128000
	v2 := v1 * v1 * int64(b.digP6)
	v2 += (v1 * int64(b.digP5)) << 17
	v2 += int64(b.digP4) << 35
	v1 = (v1*v1*int64(b.digP3))>>8 + (v1*int64(b.digP2))<<12
	v1 = (int64(1)<<47 + v1) * int64(b.digP1) >> 33
	if v1 == 0 {
		return 0
	}
	p := int64(1048576) - int64(rawP)
	p = ((p<<31 - v2) * 3125) / v1
	v1 = (int64(b.digP9) * (p >> 13) * (p >> 13)) >> 25
	v2 = (int64(b.digP8) * p) >> 19
	p = (p+v1+v2)>>8 + int64(b.digP7)<<4
	return float32(p) / 25600.0
}

func (b *BME280Sensor) compensateHumidity(rawH, tFine int32) float32 {
	x := tFine - 76800
	x = (((rawH << 14) - int32(b.digH4)<<20 - int32(b.digH5)*x + 16384) >> 15) *
		(((((((x*int32(b.digH6))>>10)*
			(((x*int32(b.digH3))>>11)+32768))>>10)+2097152)*
			int32(b.digH2)+8192)>>14)
	x -= (((x >> 15) * (x >> 15)) >> 7) * int32(b.digH1) >> 4
	if x < 0 {
		x = 0
	}
	if x > 419430400 {
		x = 419430400
	}
	return float32(x>>12) / 1024.0
}
