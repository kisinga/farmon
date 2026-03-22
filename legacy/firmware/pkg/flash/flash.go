// Package flash provides key-value persistence over internal flash.
// Implements a wear-leveled two-page scheme identical to the original
// STM32WL implementation, but hardware-agnostic via FlashHardware.
package flash

import "encoding/binary"

const headerSize = 6 // magic(2) + version(1) + seq(1) + crc16(2)

// FlashHardware abstracts the hardware-specific flash operations.
// Each target provides a concrete implementation.
type FlashHardware interface {
	ReadAt(buf []byte, off int64) (int, error)
	WriteAt(buf []byte, off int64) (int, error)
	EraseBlocks(off int64, blockCount int) error
	// DataEnd returns the address of the first byte past the flash data region.
	DataEnd() uintptr
	// PageSize returns the erase block size in bytes (2048 STM32WL, 4096 RP2040).
	PageSize() int
	// WriteAlign returns the minimum write granularity in bytes (8 STM32WL, 4 RP2040).
	WriteAlign() int
}

// Store manages two alternating flash pages for wear-leveled persistence.
type Store struct {
	hw    FlashHardware
	pageA uintptr
	pageB uintptr
	magic uint16
}

// New creates a Store using the last two pages of the flash data region.
// magic allows each target to use a distinct magic word (prevents cross-target
// flash reads if a chip is reused).
func New(hw FlashHardware, magic uint16) *Store {
	end := hw.DataEnd()
	ps := uintptr(hw.PageSize())
	return &Store{
		hw:    hw,
		pageA: end - 2*ps,
		pageB: end - ps,
		magic: magic,
	}
}

// Save writes a settings blob to the next flash page.
func (s *Store) Save(data []byte) error {
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
	binary.LittleEndian.PutUint16(buf[0:2], s.magic)
	buf[2] = 1 // page header version (separate from settings codec version)
	buf[3] = seq
	copy(buf[headerSize:], data)
	crc := CRC16(buf[headerSize:])
	binary.LittleEndian.PutUint16(buf[4:6], crc)

	if err := s.hw.EraseBlocks(int64(target), 1); err != nil {
		return err
	}

	// Pad to write alignment boundary.
	align := s.hw.WriteAlign()
	if r := len(buf) % align; r != 0 {
		buf = append(buf, make([]byte, align-r)...)
	}
	_, err := s.hw.WriteAt(buf, int64(target))
	return err
}

// Load reads the most recent valid settings blob from flash.
func (s *Store) Load(maxLen int) ([]byte, bool) {
	dataA, seqA, okA := s.readPage(s.pageA, maxLen)
	dataB, seqB, okB := s.readPage(s.pageB, maxLen)

	if okA && okB {
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
	var hdr [headerSize]byte
	if _, err := s.hw.ReadAt(hdr[:], int64(addr)); err != nil {
		return nil, 0, false
	}

	if binary.LittleEndian.Uint16(hdr[0:2]) != s.magic {
		return nil, 0, false
	}
	seq := hdr[3]
	storedCRC := binary.LittleEndian.Uint16(hdr[4:6])

	data := make([]byte, maxLen)
	if _, err := s.hw.ReadAt(data, int64(addr)+headerSize); err != nil {
		return nil, 0, false
	}

	if CRC16(data) != storedCRC {
		return nil, 0, false
	}
	return data, seq, true
}

func (s *Store) readSeq(addr uintptr) uint8 {
	var hdr [headerSize]byte
	s.hw.ReadAt(hdr[:], int64(addr))
	if binary.LittleEndian.Uint16(hdr[0:2]) != s.magic {
		return 0
	}
	return hdr[3]
}
