//go:build esp32s3

// Stub radio controller for Heltec WiFi LoRa 32 V3.
//
// TinyGo's ESP32-S3 target does not yet support SPI, so we cannot
// communicate with the SX1262. This file defines the SX1262 pin mapping
// and a serial stub transport for testing until SPI support arrives.
//
// Heltec V3 SX1262 wiring (from schematic):
//   SPI CS:  GPIO8    SPI SCK:  GPIO9
//   SPI MOSI: GPIO10  SPI MISO: GPIO11
//   RST: GPIO12       BUSY: GPIO13      DIO1: GPIO14
package main

import (
	"encoding/hex"

	"github.com/kisinga/farmon/firmware/pkg/transport"
)

// serialStubTransport prints telemetry to serial output.
// Placeholder until TinyGo adds SPI support for ESP32-S3.
type serialStubTransport struct{}

var _ transport.Transport = (*serialStubTransport)(nil)

func (t *serialStubTransport) Send(p transport.Packet) bool {
	println("[stub-tx] fport=", p.Port, " len=", p.Len, " hex=", hex.EncodeToString(p.Payload[:p.Len]))
	return true
}

func (t *serialStubTransport) Recv() (transport.Packet, bool) {
	return transport.Packet{}, false
}

func (t *serialStubTransport) IsReady() bool {
	return true
}
