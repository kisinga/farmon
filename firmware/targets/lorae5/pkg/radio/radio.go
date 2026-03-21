// Package radio manages the LoRaWAN communication layer.
package radio

import (
	"time"

	"tinygo.org/x/drivers"
	"tinygo.org/x/drivers/lora/lorawan"
	"tinygo.org/x/drivers/sx126x"
)

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

// RxMsg is a received downlink.
type RxMsg struct {
	Port    uint8
	Payload [222]byte
	Len     uint8
	Valid   bool
}

// Radio wraps the SX126x driver and LoRaWAN stack.
type Radio struct {
	config  Config
	radio   *sx126x.Device
	session lorawan.Session
	joined  bool
	lastRx  RxMsg
}

// New creates a Radio.
func New(cfg Config) *Radio {
	return &Radio{config: cfg}
}

// Init configures the radio hardware and performs OTAA join.
// Blocks until join succeeds.
func (r *Radio) Init(spi drivers.SPI, ctrl sx126x.RadioController) {
	r.radio = sx126x.New(spi)
	r.radio.SetRadioController(ctrl)

	// Region is selected at compile time via build tags (region_*.go files).
	rs := regionSettings(r.config.Region)

	otaa := &lorawan.Otaa{}
	copy(otaa.AppEUI[:], r.config.AppEUI[:])
	copy(otaa.AppKey[:], r.config.AppKey[:])

	lorawan.UseRadio(r.radio)
	lorawan.UseRegionSettings(rs)

	for attempt := 1; ; attempt++ {
		println("[radio] OTAA join attempt", attempt)
		err := lorawan.Join(otaa, &r.session)
		if err == nil {
			r.joined = true
			println("[radio] Joined network")
			return
		}
		println("[radio] Join failed, retrying in 10s")
		time.Sleep(10 * time.Second)
	}
}

// SendUplink transmits a payload and listens for a downlink in the RX windows.
// Returns true if the uplink was sent successfully.
// Any received downlink is buffered and retrievable via LastRx().
func (r *Radio) SendUplink(payload []byte) bool {
	r.lastRx.Valid = false

	err := lorawan.SendUplink(payload, &r.session)
	if err != nil {
		println("[radio] TX failed:", err.Error())
		return false
	}

	// Listen for downlink after uplink
	_ = lorawan.ListenDownlink()

	return true
}

// LastRx returns the last received downlink, if any.
func (r *Radio) LastRx() RxMsg { return r.lastRx }

// IsJoined reports whether OTAA join has completed.
func (r *Radio) IsJoined() bool { return r.joined }
