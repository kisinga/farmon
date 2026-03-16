// Package flash provides key-value persistence over STM32WL internal flash.
// Replaces ESP32 NVS/Preferences with a simple wear-leveled two-page scheme.
package flash

import (
	"encoding/binary"
	"machine"
)

const (
	pageSize   = 2048 // STM32WL flash erase block
	headerSize = 6    // magic(2) + version(1) + seq(1) + crc16(2)
	magicWord  = 0xFA12
)

// Store manages two alternating flash pages for wear-leveled persistence.
type Store struct {
	pageA uintptr // address of first flash page
	pageB uintptr // address of second flash page
}

// New creates a Store using the last two pages of flash data region.
func New() *Store {
	end := machine.FlashDataEnd()
	return &Store{
		pageA: end - 2*pageSize,
		pageB: end - pageSize,
	}
}

// Save writes a settings blob to the next flash page.
func (s *Store) Save(data []byte) error {
	// Determine which page to write (alternate based on sequence number)
	seqA := s.readSeq(s.pageA)
	seqB := s.readSeq(s.pageB)

	var target uintptr
	var seq uint8
	if seqA >= seqB {
		target = s.pageB
		seq = seqA + 1
	} else {
		target = s.pageA
		seq = seqB + 1
	}

	// Build page: [magic:2][version:1][seq:1][crc16:2][data...]
	buf := make([]byte, headerSize+len(data))
	binary.LittleEndian.PutUint16(buf[0:2], magicWord)
	buf[2] = 1 // version
	buf[3] = seq
	copy(buf[headerSize:], data)
	crc := crc16(buf[headerSize:])
	binary.LittleEndian.PutUint16(buf[4:6], crc)

	// Erase page
	err := machine.Flash.EraseBlocks(int64(target), 1)
	if err != nil {
		return err
	}

	// Write (must be 8-byte aligned on STM32WL)
	padded := len(buf)
	if padded%8 != 0 {
		padded += 8 - (padded % 8)
		buf = append(buf, make([]byte, padded-len(buf))...)
	}
	_, err = machine.Flash.WriteAt(buf, int64(target))
	return err
}

// Load reads the most recent valid settings blob from flash.
func (s *Store) Load(maxLen int) ([]byte, bool) {
	dataA, seqA, okA := s.readPage(s.pageA, maxLen)
	dataB, seqB, okB := s.readPage(s.pageB, maxLen)

	if okA && okB {
		// Pick the one with higher sequence (handles uint8 wrap)
		if int8(seqA-seqB) > 0 {
			return dataA, true
		}
		return dataB, true
	}
	if okA {
		return dataA, true
	}
	if okB {
		return dataB, true
	}
	return nil, false
}

func (s *Store) readPage(addr uintptr, maxLen int) ([]byte, uint8, bool) {
	hdr := make([]byte, headerSize)
	_, err := machine.Flash.ReadAt(hdr, int64(addr))
	if err != nil {
		return nil, 0, false
	}

	magic := binary.LittleEndian.Uint16(hdr[0:2])
	if magic != magicWord {
		return nil, 0, false
	}

	seq := hdr[3]
	storedCRC := binary.LittleEndian.Uint16(hdr[4:6])

	data := make([]byte, maxLen)
	_, err = machine.Flash.ReadAt(data, int64(addr)+headerSize)
	if err != nil {
		return nil, 0, false
	}

	if crc16(data) != storedCRC {
		return nil, 0, false
	}

	return data, seq, true
}

func (s *Store) readSeq(addr uintptr) uint8 {
	hdr := make([]byte, headerSize)
	machine.Flash.ReadAt(hdr, int64(addr))
	if binary.LittleEndian.Uint16(hdr[0:2]) != magicWord {
		return 0
	}
	return hdr[3]
}

// crc16 computes CRC-16-CCITT (same as C++ firmware for wire compatibility).
func crc16(data []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc ^= uint16(b) << 8
		for k := 0; k < 8; k++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc = crc << 1
			}
		}
	}
	return crc
}
