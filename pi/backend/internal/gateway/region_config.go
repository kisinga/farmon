package gateway

import (
	"github.com/chirpstack/chirpstack/api/go/v4/gw"
)

// EU868 multi_sf + lora_std frequencies from setup_gateway.sh.
var eu868Channels = []uint32{868100000, 868300000, 868500000, 867100000, 867300000, 867500000, 867700000, 867900000}

// US915 uplink (multi_sf) and downlink (923 MHz band) frequencies used by setup_gateway.sh.
// Downlink must be in 923–927.5 MHz so gateway can TX where the device listens for RX1.
var us915UplinkChannels = []uint32{903900000, 904100000, 904300000, 904500000, 904700000, 904900000, 905100000, 905300000}

// BuildUS915GatewayConfig returns a GatewayConfiguration with only the 8 uplink channels.
// For optional config push via concentratord "config" command only; do not add the 8 downlink (923 MHz) channels here.
// Channel/region configuration is normally file-based (TOML). The "channels do not fit" error at startup
// is avoided by setting lora_std to the uplink band (e.g. 904.6 MHz) in channels_us915.toml; the gateway
// still transmits at 923 MHz for Class A downlinks using the frequency from the DownlinkFrame.
// The pipeline does not call SendConfig.
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

// BuildEU868GatewayConfig returns a GatewayConfiguration with EU868 channels (multi_sf from setup_gateway.sh).
func BuildEU868GatewayConfig(gatewayID string) *gw.GatewayConfiguration {
	channels := make([]*gw.ChannelConfiguration, 0, len(eu868Channels))
	for _, freq := range eu868Channels {
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
		Version:   "eu868-v1",
		Channels:  channels,
	}
}

// GatewayConfigForRegion returns GatewayConfiguration for the given region ("EU868" or "US915"). Unknown returns nil.
func GatewayConfigForRegion(region, gatewayID string) *gw.GatewayConfiguration {
	switch region {
	case "EU868":
		return BuildEU868GatewayConfig(gatewayID)
	case "US915":
		return BuildUS915GatewayConfig(gatewayID)
	default:
		return nil
	}
}
