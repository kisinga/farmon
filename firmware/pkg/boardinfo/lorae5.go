package boardinfo

import "github.com/kisinga/farmon/firmware/pkg/settings"

// LoRa-E5 / Wio-E5 mini (STM32WL) board definition.
// Firmware: PA0–PA7 → index 0–7, PB0–PB7 → index 8–15, PB8/9/10/15 → index 16–19.
// Only pins broken out on the Wio-E5 mini headers are listed.
func init() {
	register(&BoardInfo{
		Model:  "lorae5",
		Label:  "Wio-E5 mini",
		SvgUrl: "boards/lorae5.svg",
		Pins: []PinDef{
			{2, "PA2 / TX", "connector6pin", "bottom"},
			{3, "PA3 / RX", "connector5pin", "bottom"},
			{4, "PA4 / NSS", "connector15pin", "top"},
			{5, "PA5 / SCK", "connector14pin", "top"},
			{6, "PA6 / MISO", "connector16pin", "top"},
			{7, "PA7 / MOSI", "connector17pin", "top"},
			{11, "PB3 / A3", "connector4pin", "bottom"},
			{12, "PB4 / A4", "connector3pin", "bottom"},
			{13, "PB5 / TX2", "connector11pin", "bottom"},
			{14, "PB6 / D0", "connector7pin", "bottom"},
			{15, "PB7 / RX2", "connector10pin", "bottom"},
			{16, "PB8 / SCL", "connector1pin", "bottom"},
			{17, "PB9 / SDA", "connector2pin", "bottom"},
		},
		DefaultBuses: []BusDef{
			{PinIndices: []int{14, 15}, PinFunctions: []int{int(settings.PinI2CSDA), int(settings.PinI2CSCL)}}, // PB6=SDA, PB7=SCL
			{PinIndices: []int{2, 3}, PinFunctions: []int{int(settings.PinUARTTX), int(settings.PinUARTRX)}},   // PA2=TX, PA3=RX
		},
	})
}
