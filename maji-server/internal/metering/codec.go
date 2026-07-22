// Package metering implements the Shengda NB-IoT/Cat.1 ultrasonic water meter
// integration: raw-UDP frame codec, device session handling, reading
// ingestion, and the downlink command queue (incl. valve control).
//
// Protocol reference: docs/vendor/shengda-udp-protocol.pdf (authoritative);
// implementation spec: docs/billing-shengda-implementation-spec.md.
package metering

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Frame layout (spec §3.1):
//
//	0101            fixed header
//	<1B>            message type: 00=uplink/control, 02=response/time-calib
//	<1B>            function code
//	<2B>            message ID, random 1-65535 (big-endian)
//	3c              format: CBOR
//	<2B>            data field length (big-endian)
//	ff              delimiter
//	<CBOR bytes>    data domain
//	<2B>            CRC16 (big-endian)
const (
	headerLen   = 2 // "0101"
	trailerLen  = 2 // CRC16
	minFrameLen = headerLen + 1 + 1 + 2 + 1 + 2 + 1 + trailerLen

	// maxFrameSize bounds accepted packets; the largest fixture is ~190 bytes
	// and a battery-powered meter has no reason to send kilobytes.
	maxFrameSize = 2048

	formatCBOR  = 0x3c
	delimiter   = 0xff
	frameHeader = 0x0101
)

// Message types.
const (
	// TypeUplink is device→server (telemetry) and server→device (commands).
	// Direction is disambiguated by the function code.
	TypeUplink = 0x00
	// TypeResponse is device→server command results and server→device
	// time-calibration.
	TypeResponse = 0x02
)

// Function codes.
const (
	FuncUplink    = 0x02 // telemetry report (TypeUplink)
	FuncControl   = 0x03 // downlink command, e.g. valve (TypeUplink)
	FuncCmdResult = 0x44 // command execution result (TypeResponse)
	FuncTimeCalib = 0x45 // time calibration (TypeResponse)
)

var (
	ErrFrameTooShort  = errors.New("metering: frame too short")
	ErrFrameTooLong   = errors.New("metering: frame exceeds max size")
	ErrBadHeader      = errors.New("metering: bad frame header")
	ErrBadFormat      = errors.New("metering: unsupported data format (not CBOR)")
	ErrBadDelimiter   = errors.New("metering: missing data delimiter")
	ErrBadLength      = errors.New("metering: data length field mismatch")
	ErrBadCRC         = errors.New("metering: CRC16 mismatch")
	ErrBadMessageID   = errors.New("metering: message ID out of range")
	ErrUnknownMsgType = errors.New("metering: unknown message type/function")
)

// Frame is one parsed protocol message. Payload holds the raw CBOR data
// domain; decoding into objects is a separate step (objects.go).
type Frame struct {
	Type    byte
	Func    byte
	ID      uint16 // 1-65535
	Payload []byte
}

// ParseFrame validates and parses one datagram. The CRC covers the full frame
// minus the 2 CRC bytes (AUG-CCITT, big-endian — locked by TestFixturesRoundTrip).
func ParseFrame(data []byte) (Frame, error) {
	if len(data) < minFrameLen {
		return Frame{}, ErrFrameTooShort
	}
	if len(data) > maxFrameSize {
		return Frame{}, ErrFrameTooLong
	}
	if binary.BigEndian.Uint16(data[0:2]) != frameHeader {
		return Frame{}, ErrBadHeader
	}
	if data[6] != formatCBOR {
		return Frame{}, ErrBadFormat
	}
	dataLen := int(binary.BigEndian.Uint16(data[7:9]))
	if data[9] != delimiter {
		return Frame{}, ErrBadDelimiter
	}
	// header(2)+type(1)+func(1)+id(2)+fmt(1)+len(2)+delim(1) = 10 bytes of prologue.
	if len(data) != 10+dataLen+trailerLen {
		return Frame{}, ErrBadLength
	}
	want := binary.BigEndian.Uint16(data[len(data)-2:])
	if got := crc16AUGCCITT(data[:len(data)-2]); got != want {
		return Frame{}, fmt.Errorf("%w: got 0x%04x want 0x%04x", ErrBadCRC, got, want)
	}
	f := Frame{
		Type:    data[2],
		Func:    data[3],
		ID:      binary.BigEndian.Uint16(data[4:6]),
		Payload: data[10 : 10+dataLen],
	}
	if f.ID == 0 {
		return Frame{}, ErrBadMessageID
	}
	switch f.Type {
	case TypeUplink:
		if f.Func != FuncUplink && f.Func != FuncControl {
			return Frame{}, ErrUnknownMsgType
		}
	case TypeResponse:
		if f.Func != FuncCmdResult && f.Func != FuncTimeCalib {
			return Frame{}, ErrUnknownMsgType
		}
	default:
		return Frame{}, ErrUnknownMsgType
	}
	return f, nil
}

// Build serializes a frame, computing the data length and CRC.
func (f Frame) Build() []byte {
	out := make([]byte, 0, 10+len(f.Payload)+trailerLen)
	out = binary.BigEndian.AppendUint16(out, frameHeader)
	out = append(out, f.Type, f.Func)
	out = binary.BigEndian.AppendUint16(out, f.ID)
	out = append(out, formatCBOR)
	out = binary.BigEndian.AppendUint16(out, uint16(len(f.Payload)))
	out = append(out, delimiter)
	out = append(out, f.Payload...)
	out = binary.BigEndian.AppendUint16(out, crc16AUGCCITT(out))
	return out
}

// crc16AUGCCITT is CRC-16/SPI-FUJITSU: poly 0x1021, init 0x1D0F,
// non-reflected, no output XOR. Determined by brute force against the vendor
// PDF's known frame↔CRC pairs (all five fixtures match; locked by test).
func crc16AUGCCITT(data []byte) uint16 {
	crc := uint16(0x1D0F)
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
