package gateway

import (
	"github.com/chirpstack/chirpstack/api/go/v4/gw"
)

// US915 uplink (multi_sf) and downlink (923 MHz band) frequencies used by setup_gateway.sh.
// Downlink must be in 923–927.5 MHz so gateway can TX where the device listens for RX1.
var us915UplinkChannels = []uint32{903900000, 904100000, 904300000, 904500000, 904700000, 904900000, 905100000, 905300000}

// BuildUS915GatewayConfig returns a GatewayConfiguration with only the 8 uplink channels.
// For optional config push via concentratord "config" command only. Do not add the 8 downlink (923 MHz)
// channels: on Waveshare SX1302 HAT the two radios are in the uplink band, so adding 923 MHz channels
// causes "the channels do not fit within the bandwidth of the two radios" and the daemon panics.
// Channel/region configuration is normally file-based (TOML); the pipeline does not call SendConfig.
func BuildUS915GatewayConfig(gatewayID string) *gw.GatewayConfiguration {
	channels := make([]*gw.ChannelConfiguration, 0, 8)
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
	return &gw.GatewayConfiguration{
		GatewayId: gatewayID,
		Version:   "us915-v1",
		Channels:  channels,
	}
}
