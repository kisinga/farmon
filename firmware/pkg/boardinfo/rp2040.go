package boardinfo

import "github.com/kisinga/farmon/firmware/pkg/settings"

// RP2040 (Raspberry Pi Pico W) board definition.
// Firmware: GP0–GP19 map 1:1 to pinMap index 0–19.
// Fritzing: connector N = physical pin (N+1). Layout from Pico W datasheet.
func init() {
	register(&BoardInfo{
		Model:     "rp2040",
		Label:     "Raspberry Pi Pico W",
		SvgUrl:    "boards/rp2040.svg",
		RotateDeg: -90,
		Pins: []PinDef{
			{0, "GP0", "connector0pin", "top"},
			{1, "GP1", "connector1pin", "top"},
			{2, "GP2", "connector3pin", "top"},
			{3, "GP3", "connector4pin", "top"},
			{4, "GP4", "connector5pin", "top"},
			{5, "GP5", "connector6pin", "top"},
			{6, "GP6", "connector8pin", "top"},
			{7, "GP7", "connector9pin", "top"},
			{8, "GP8", "connector10pin", "top"},
			{9, "GP9", "connector11pin", "top"},
			{10, "GP10", "connector13pin", "bottom"},
			{11, "GP11", "connector14pin", "bottom"},
			{12, "GP12", "connector15pin", "bottom"},
			{13, "GP13", "connector16pin", "bottom"},
			{14, "GP14", "connector18pin", "bottom"},
			{15, "GP15", "connector19pin", "bottom"},
			{16, "GP16", "connector20pin", "bottom"},
			{17, "GP17", "connector21pin", "bottom"},
			{18, "GP18", "connector23pin", "bottom"},
			{19, "GP19", "connector24pin", "bottom"},
		},
		InternalOutputs: []InternalOutput{
			{ActuatorType: 7, Label: "Pico W LED", GPIONum: 0}, // CYW43 LED, special handling in firmware
		},
		DefaultBuses: []BusDef{
			{PinIndices: []int{4, 5}, PinFunctions: []int{int(settings.PinI2CSDA), int(settings.PinI2CSCL)}},   // GP4=SDA, GP5=SCL (I2C0)
			{PinIndices: []int{8, 9}, PinFunctions: []int{int(settings.PinUARTTX), int(settings.PinUARTRX)}},    // GP8=TX, GP9=RX (UART1)
		},
	})
}
