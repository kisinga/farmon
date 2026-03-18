package sensors

import (
	"machine"
	"time"
)

// 1-Wire bit-bang protocol helpers.
// Used by DS18B20 and any future 1-Wire driver.

func owReset(pin machine.Pin) bool {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	time.Sleep(480 * time.Microsecond)
	pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	time.Sleep(70 * time.Microsecond)
	present := !pin.Get()
	time.Sleep(410 * time.Microsecond)
	return present
}

func owWriteBit(pin machine.Pin, bit bool) {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	if bit {
		time.Sleep(6 * time.Microsecond)
		pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
		time.Sleep(64 * time.Microsecond)
	} else {
		time.Sleep(60 * time.Microsecond)
		pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
		time.Sleep(10 * time.Microsecond)
	}
}

func owReadBit(pin machine.Pin) bool {
	pin.Configure(machine.PinConfig{Mode: machine.PinOutput})
	pin.Low()
	time.Sleep(3 * time.Microsecond)
	pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	time.Sleep(10 * time.Microsecond)
	bit := pin.Get()
	time.Sleep(53 * time.Microsecond)
	return bit
}

func owWriteByte(pin machine.Pin, b uint8) {
	for i := 0; i < 8; i++ {
		owWriteBit(pin, b&(1<<uint(i)) != 0)
	}
}

func owReadByte(pin machine.Pin) uint8 {
	var b uint8
	for i := 0; i < 8; i++ {
		if owReadBit(pin) {
			b |= 1 << uint(i)
		}
	}
	return b
}
