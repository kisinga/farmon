//go:build esp32s3

// Package flash provides the ESP32-S3 concrete FlashHardware implementation.
package flash

import "machine"

// ESP32S3Flash implements flash.FlashHardware for the ESP32-S3.
type ESP32S3Flash struct{}

func (f ESP32S3Flash) ReadAt(buf []byte, off int64) (int, error) {
	return machine.Flash.ReadAt(buf, off)
}

func (f ESP32S3Flash) WriteAt(buf []byte, off int64) (int, error) {
	return machine.Flash.WriteAt(buf, off)
}

func (f ESP32S3Flash) EraseBlocks(off int64, blockCount int) error {
	return machine.Flash.EraseBlocks(off, int64(blockCount))
}

func (f ESP32S3Flash) DataEnd() uintptr {
	return machine.FlashDataEnd()
}

func (f ESP32S3Flash) PageSize() int {
	return 4096 // ESP32-S3 flash sector size
}

func (f ESP32S3Flash) WriteAlign() int {
	return 4
}
