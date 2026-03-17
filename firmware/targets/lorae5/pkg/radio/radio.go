// Package radio manages the LoRaWAN communication layer.
// Replaces FreeRTOS queues + RadioLib with goroutines + channels + TinyGo sx126x driver.
package radio

import (
	"time"

	"tinygo.org/x/drivers/lora/lorawan"
	"tinygo.org/x/drivers/sx126x"
)

// TxMsg is a message to transmit (app -> radio goroutine).
type TxMsg struct {
	Port      uint8
	Confirmed bool
	Payload   [222]byte
	Len       uint8
}

// RxMsg is a received downlink (radio goroutine -> app).
type RxMsg struct {
	Port    uint8
	Payload [222]byte
	Len     uint8
}

// Config holds LoRaWAN session parameters.
type Config struct {
	AppEUI     [8]byte
	AppKey     [16]byte
	Region     string // "US915", "EU868", etc.
	SubBand    uint8
	DataRate   uint8
	TxPower    uint8
	ADREnabled bool
}

// Radio wraps the SX126x driver and LoRaWAN stack.
type Radio struct {
	TxChan chan TxMsg
	RxChan chan RxMsg
	config Config
	radio  *sx126x.Device
	joined bool
}

// New creates a Radio with buffered channels.
func New(cfg Config) *Radio {
	return &Radio{
		TxChan: make(chan TxMsg, 8),
		RxChan: make(chan RxMsg, 4),
		config: cfg,
	}
}

// Run is the main radio goroutine. Call as: go radio.Run(spi, radioCtrl)
func (r *Radio) Run(spi sx126x.SPI, ctrl sx126x.RadioController) {
	r.radio = sx126x.New(spi)
	r.radio.SetRadioController(ctrl)

	// Configure region
	var region lorawan.RegionSettings
	switch r.config.Region {
	case "US915":
		region = lorawan.RegionSettings{
			Freq:         902300000,
			ChannelStep:  200000,
			NumChannels:  64,
			DownlinkFreq: 923300000,
			DownlinkStep: 600000,
			NumDownlink:  8,
			DataRate:     r.config.DataRate,
		}
	default:
		region = lorawan.RegionSettings{
			Freq:        868100000,
			ChannelStep: 200000,
			NumChannels: 8,
			DataRate:    r.config.DataRate,
		}
	}

	otaa := lorawan.OTAAConfig{}
	copy(otaa.AppEUI[:], r.config.AppEUI[:])
	copy(otaa.AppKey[:], r.config.AppKey[:])

	lorawan.UseRadio(r.radio)
	lorawan.UseRegionSettings(region)

	// Join with retry
	var session lorawan.Session
	for attempt := 1; ; attempt++ {
		println("[radio] OTAA join attempt", attempt)
		err := lorawan.Join(&otaa, &session)
		if err == nil {
			r.joined = true
			println("[radio] Joined network")
			break
		}
		println("[radio] Join failed, retrying in 10s")
		time.Sleep(10 * time.Second)
	}

	// Main loop: service TX channel, forward downlinks to RX channel
	for {
		select {
		case msg := <-r.TxChan:
			if !r.joined {
				continue
			}

			err := lorawan.SendUplink(msg.Payload[:msg.Len], &session)
			if err != nil {
				println("[radio] TX failed:", err.Error())
				continue
			}

			// Check for downlink in RX windows
			var rxBuf [222]byte
			n, port, err := lorawan.ReceiveDownlink(rxBuf[:], &session)
			if err == nil && n > 0 {
				rx := RxMsg{Port: port, Len: uint8(n)}
				copy(rx.Payload[:], rxBuf[:n])
				select {
				case r.RxChan <- rx:
				default:
					println("[radio] RX chan full, dropping")
				}
			}

		case <-time.After(100 * time.Millisecond):
			// Keep loop responsive
		}
	}
}

func (r *Radio) IsJoined() bool { return r.joined }
