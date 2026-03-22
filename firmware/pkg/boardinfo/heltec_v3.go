package boardinfo

// Heltec WiFi LoRa 32 V3 (ESP32-S3) board definition.
// Connector IDs from Fritzing part: part.Heltec WiFi Kit 32 (V3)-latest_*.fzp
// Excluded from user pins: GPIO8-14 (SX1262 LoRa SPI), GPIO17-18 (OLED I2C),
// GPIO19-20 (USB), GPIO43-44 (UART0), GPIO0/21/45/46 (strapping/OLED RST).
func init() {
	register(&BoardInfo{
		Model:  "heltec_v3",
		Label:  "Heltec WiFi LoRa 32 V3",
		SvgUrl: "boards/heltec_v3.svg",
		Pins: []PinDef{
			// J2 header (bottom edge) — GPIO1-7 have ADC1
			{0, "GPIO1", "connector35pin", "bottom"},
			{1, "GPIO2", "connector34pin", "bottom"},
			{2, "GPIO3", "connector33pin", "bottom"},
			{3, "GPIO4", "connector32pin", "bottom"},
			{4, "GPIO5", "connector31pin", "bottom"},
			{5, "GPIO6", "connector30pin", "bottom"},
			{6, "GPIO7", "connector29pin", "bottom"},
			// J3 header (top edge)
			{7, "GPIO26", "connector14pin", "top"},
			{8, "GPIO33", "connector11pin", "top"},
			{9, "GPIO34", "connector10pin", "top"},
			{10, "GPIO35", "connector9pin", "top"},
			{11, "GPIO36", "connector8pin", "top"},
			{12, "GPIO37", "connector7pin", "top"},
			{13, "GPIO38", "connector6pin", "top"},
			{14, "GPIO39", "connector5pin", "top"},
			{15, "GPIO40", "connector4pin", "top"},
			{16, "GPIO41", "connector3pin", "top"},
			{17, "GPIO42", "connector2pin", "top"},
			{18, "GPIO47", "connector12pin", "top"},
			{19, "GPIO48", "connector13pin", "top"},
		},
	})
}
