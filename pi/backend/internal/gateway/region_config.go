package gateway

import (
	"github.com/chirpstack/chirpstack/api/go/v4/gw"
)

// US915 uplink (multi_sf) and downlink (923 MHz band) frequencies used by setup_gateway.sh.
// Downlink must be in 923–927.5 MHz so gateway can TX where the device listens for RX1.
var (
	us915UplinkChannels   = []uint32{903900000, 904100000, 904300000, 904500000, 904700000, 904900000, 905100000, 905300000}
	us915DownlinkChannels = []uint32{923300000, 923900000, 924500000, 925100000, 925700000, 926300000, 926900000, 927500000}
)

// BuildUS915GatewayConfig returns a GatewayConfiguration so the concentratord can TX in both
// uplink (903.9–905.3 MHz) and downlink (923.3–927.5 MHz) bands. Pushing this via the config
// command ensures the gateway accepts downlinks at 923 MHz instead of only the static lora_std.
func BuildUS915GatewayConfig(gatewayID string) *gw.GatewayConfiguration {
	channels := make([]*gw.ChannelConfiguration, 0, 16)
	// Uplink: multi-SF (same as concentratord multi_sf_channels)
	for _, freq := range us915UplinkChannels {
		channels = append(channels, &gw.ChannelConfiguration{
			Frequency: freq,
			ModulationConfig: &gw.ChannelConfiguration_LoraModulationConfig{
				LoraModulationConfig: &gw.LoraModulationConfig{
					Bandwidth:        125000,
					SpreadingFactors: []uint32{7, 8, 9, 10, 11, 12},
				},
			},
		})
	}
	// Downlink: 923 MHz band, DR8 (SF12, 500 kHz) for RX1
	for _, freq := range us915DownlinkChannels {
		channels = append(channels, &gw.ChannelConfiguration{
			Frequency: freq,
			ModulationConfig: &gw.ChannelConfiguration_LoraModulationConfig{
				LoraModulationConfig: &gw.LoraModulationConfig{
					Bandwidth:        500000,
					SpreadingFactors: []uint32{12},
				},
			},
		})
	}
	return &gw.GatewayConfiguration{
		GatewayId: gatewayID,
		Version:   "us915-v1",
		Channels:  channels,
	}
}
