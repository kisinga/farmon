package gateway

import (
	"github.com/chirpstack/chirpstack/api/go/v4/gw"
)

// RegionProfile provides region-specific RX1 frequency and modulation for Class A downlinks.
// Config.Region selects the profile (e.g. EU868, US915).
type RegionProfile interface {
	// RX1FrequencyHz returns the downlink frequency for RX1. overrideHz from gateway settings (rx1_frequency_hz) takes precedence when non-zero.
	RX1FrequencyHz(uplinkFreqHz, overrideHz uint32) uint32
	// RX1Modulation returns bandwidth (Hz), spreading factor, and code rate for the RX1 downlink.
	RX1Modulation() (bandwidth, spreadingFactor uint32, codeRate gw.CodeRate)
}

// EU868Profile implements RegionProfile for EU868. RX1 uses same frequency as uplink; SF7/125 kHz.
type EU868Profile struct{}

func (EU868Profile) RX1FrequencyHz(uplinkFreqHz, overrideHz uint32) uint32 {
	if overrideHz != 0 {
		return overrideHz
	}
	return uplinkFreqHz
}

func (EU868Profile) RX1Modulation() (bandwidth, spreadingFactor uint32, codeRate gw.CodeRate) {
	return 125000, 7, gw.CodeRate_CR_4_5
}

// US915 profile constants (LoRaWAN regional parameters).
const (
	us915UplinkMinHz   uint32 = 902300000
	us915UplinkMaxHz   uint32 = 914900000
	us915UplinkStepHz  uint32 = 200000
	us915DownlinkBase  uint32 = 923300000
	us915DownlinkStep  uint32 = 600000
	us915NumUplinkCh   uint32 = 64
)

// US915Profile implements RegionProfile for US915. RX1 is in 923 MHz band.
// SingleDownlinkChannel: when true, use 923.3 MHz only (gateway has one lora_std). When false, use 923.3 + (ch%8)*0.6 MHz.
type US915Profile struct {
	SingleDownlinkChannel bool
}

func (p US915Profile) RX1FrequencyHz(uplinkFreqHz, overrideHz uint32) uint32 {
	if overrideHz != 0 {
		return overrideHz
	}
	// When concentratord omits uplink TxInfo we get 0; use region default so we never send downlink freq 0.
	if uplinkFreqHz == 0 {
		return us915DownlinkBase
	}
	if uplinkFreqHz < us915UplinkMinHz || uplinkFreqHz > us915UplinkMaxHz {
		return uplinkFreqHz
	}
	if p.SingleDownlinkChannel {
		return us915DownlinkBase
	}
	channel := (uplinkFreqHz - us915UplinkMinHz) / us915UplinkStepHz
	if channel >= us915NumUplinkCh {
		channel = us915NumUplinkCh - 1
	}
	rx1Ch := channel % 8
	return us915DownlinkBase + rx1Ch*us915DownlinkStep
}

func (US915Profile) RX1Modulation() (bandwidth, spreadingFactor uint32, codeRate gw.CodeRate) {
	return 500000, 12, gw.CodeRate_CR_4_5 // DR8 for US915 RX1
}

// ProfileForRegion returns the RegionProfile for the given region string (e.g. "EU868", "US915").
// Unknown or empty region returns EU868Profile.
func ProfileForRegion(region string) RegionProfile {
	switch region {
	case "US915":
		return US915Profile{SingleDownlinkChannel: true} // Waveshare SX1302 HAT has one lora_std
	case "EU868":
		return EU868Profile{}
	default:
		return EU868Profile{}
	}
}
