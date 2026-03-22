//go:build rp2040

// Package flash provides the RP2040 concrete FlashHardware implementation.
// The RP2040 uses 4096-byte erase sectors and 4-byte aligned writes.
package flash

import "machine"

// RP2040Flash implements flash.FlashHardware for the Raspberry Pi Pico (W).
type RP2040Flash struct{}

func (f RP2040Flash) ReadAt(buf []byte, off int64) (int, error) {
	return machine.Flash.ReadAt(buf, off)
}

func (f RP2040Flash) WriteAt(buf []byte, off int64) (int, error) {
	return machine.Flash.WriteAt(buf, off)
}

func (f RP2040Flash) EraseBlocks(off int64, blockCount int) error {
	return machine.Flash.EraseBlocks(off, int64(blockCount))
}

func (f RP2040Flash) DataEnd() uintptr {
	return machine.FlashDataEnd()
}

func (f RP2040Flash) PageSize() int {
	return 4096 // RP2040 flash sector size
}

func (f RP2040Flash) WriteAlign() int {
	return 4 // RP2040 requires 4-byte aligned writes
}
