//go:build stm32wlx || lorae5

// Package flash provides the STM32WL concrete FlashHardware implementation.
// Uses the internal flash peripheral with 2048-byte erase blocks and 8-byte
// minimum write granularity as required by the STM32WL flash controller.
package flash

import "machine"

// STM32WLFlash implements flash.FlashHardware for the STM32WL internal flash.
type STM32WLFlash struct{}

func (f STM32WLFlash) ReadAt(buf []byte, off int64) (int, error) {
	return machine.Flash.ReadAt(buf, off)
}

func (f STM32WLFlash) WriteAt(buf []byte, off int64) (int, error) {
	return machine.Flash.WriteAt(buf, off)
}

func (f STM32WLFlash) EraseBlocks(off int64, blockCount int) error {
	return machine.Flash.EraseBlocks(off, int64(blockCount))
}

func (f STM32WLFlash) DataEnd() uintptr {
	return machine.FlashDataEnd()
}

func (f STM32WLFlash) PageSize() int {
	return 2048 // STM32WL flash erase block
}

func (f STM32WLFlash) WriteAlign() int {
	return 8 // STM32WL requires 8-byte aligned writes
}
