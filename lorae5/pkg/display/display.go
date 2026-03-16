// Package display drives an SSD1306 OLED over I2C.
package display

import (
	"machine"
	"strconv"

	"tinygo.org/x/drivers/ssd1306"
)

type Display struct {
	dev ssd1306.Device
	buf [128 * 64 / 8]byte // framebuffer
}

// New initializes the SSD1306 on the given I2C bus.
func New(bus *machine.I2C) *Display {
	d := &Display{}
	d.dev = ssd1306.NewI2C(bus)
	d.dev.Configure(ssd1306.Config{
		Address: 0x3C,
		Width:   128,
		Height:  64,
	})
	d.dev.ClearDisplay()
	return d
}

// Status renders a simple status screen (replaces the C++ UI components).
func (d *Display) Status(joined bool, batteryPct uint8, txCount, rxCount uint32, msg string) {
	d.dev.ClearBuffer()

	y := int16(0)
	// Line 1: connection status
	if joined {
		d.drawText(0, y, "LoRa: OK")
	} else {
		d.drawText(0, y, "LoRa: --")
	}
	d.drawText(80, y, "B:"+strconv.Itoa(int(batteryPct))+"%")

	// Line 2: counters
	y = 16
	d.drawText(0, y, "TX:"+strconv.FormatUint(uint64(txCount), 10))
	d.drawText(64, y, "RX:"+strconv.FormatUint(uint64(rxCount), 10))

	// Line 3: message
	y = 32
	if len(msg) > 21 {
		msg = msg[:21]
	}
	d.drawText(0, y, msg)

	d.dev.Display()
}

// drawText renders ASCII text at pixel position using a basic 6x8 font.
// For a production build, use tinyfont or a bitmap font package.
func (d *Display) drawText(x, y int16, text string) {
	for i, ch := range text {
		if ch < 32 || ch > 126 {
			ch = '?'
		}
		px := x + int16(i)*6
		if px+6 > 128 {
			break
		}
		d.drawChar(px, y, byte(ch))
	}
}

// drawChar draws a single 5x8 character. Placeholder - use tinyfont in production.
func (d *Display) drawChar(x, y int16, c byte) {
	// Minimal: just set pixels for the character's bounding box outline
	// In production, index into a font table
	for row := int16(0); row < 8; row++ {
		for col := int16(0); col < 5; col++ {
			// Simple hash to make characters visually distinct
			if (int(c)*7+int(row)*3+int(col)*5)%3 == 0 {
				d.dev.SetPixel(x+col, y+row, 1)
			}
		}
	}
}
