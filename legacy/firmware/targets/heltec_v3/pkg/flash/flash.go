//go:build esp32s3

// Package flash provides a stub FlashHardware for ESP32-S3.
// TinyGo does not yet support machine.Flash on esp32s3.
// Settings persistence is a no-op until flash support is added.
package flash

// ESP32S3Flash is a stub — flash not yet supported by TinyGo on ESP32-S3.
type ESP32S3Flash struct{}

func (f ESP32S3Flash) ReadAt(buf []byte, off int64) (int, error) {
	return 0, nil
}

func (f ESP32S3Flash) WriteAt(buf []byte, off int64) (int, error) {
	return len(buf), nil
}

func (f ESP32S3Flash) EraseBlocks(off int64, blockCount int) error {
	return nil
}

func (f ESP32S3Flash) DataEnd() uintptr {
	return 0x3C000000 // ESP32-S3 flash base (placeholder)
}

func (f ESP32S3Flash) PageSize() int {
	return 4096
}

func (f ESP32S3Flash) WriteAlign() int {
	return 4
}
