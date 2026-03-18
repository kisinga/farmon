package sensors

import "machine"

// volatile32 is a simple counter wrapper.
// TinyGo does not have atomic ops on all targets; interrupt handlers
// increment this directly. Reads/clears happen only from the main goroutine.
type volatile32 struct {
	val uint32
}

// pulseCounter is the shared interrupt-driven pulse counting base.
// Embed in any driver that counts falling-edge pulses on a GPIO pin.
type pulseCounter struct {
	pin   machine.Pin
	count volatile32
	total uint32
}

// begin configures the pin as pull-up input and attaches the falling-edge interrupt.
func (p *pulseCounter) begin() {
	p.pin.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
	p.pin.SetInterrupt(machine.PinFalling, func(_ machine.Pin) {
		p.count.val++
	})
}

// consume drains the pulse count atomically, accumulates the running total,
// and returns the delta since the last call.
func (p *pulseCounter) consume() uint32 {
	d := p.count.val
	p.count.val = 0
	p.total += d
	return d
}
