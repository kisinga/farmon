package gateway

import (
	"log"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"google.golang.org/protobuf/types/known/durationpb"
)

// JoinAcceptDelaySec is the fixed RX1 delay for JoinAccept downlinks (LoRaWAN JOIN_ACCEPT_DELAY1).
// The device opens its JoinAccept receive window exactly this many seconds after the JoinRequest TX.
const JoinAcceptDelaySec = 5

// BuildClassADownlink builds a DownlinkFrame for a Class A downlink (JoinAccept or data reply).
// delaySec is the RX1 window delay in seconds — use JoinAcceptDelaySec for JoinAccept,
// DataDownlinkRX1DelaySec for data downlinks.
func BuildClassADownlink(cfg *Config, profile RegionProfile, phyPayload []byte, uplink *gw.UplinkFrame, delaySec int) *gw.DownlinkFrame {
	item := &gw.DownlinkFrameItem{PhyPayload: phyPayload, TxInfo: &gw.DownlinkTxInfo{}}
	df := &gw.DownlinkFrame{Items: []*gw.DownlinkFrameItem{item}}
	rx := uplink.GetRxInfo()
	hasContext := rx != nil && len(rx.GetContext()) > 0

	if rx != nil {
		df.GatewayId = rx.GetGatewayId()
	}
	if df.GatewayId == "" {
		df.GatewayId = cfg.GatewayID
	}

	if hasContext {
		item.TxInfo.Context = rx.GetContext()
		item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Delay{
				Delay: &gw.DelayTimingInfo{Delay: durationpb.New(time.Duration(delaySec) * time.Second)},
			},
		}
		uplinkFreqHz := uplinkFrequency(uplink)
		item.TxInfo.Frequency = profile.RX1FrequencyHz(uplinkFreqHz, cfg.RX1FrequencyHz)
		if item.TxInfo.Frequency == 0 {
			log.Printf("downlink: WARNING Class A downlink freq_hz=0; set rx1_frequency_hz in gateway settings or fix concentratord event parsing")
		} else {
			log.Printf("Class A downlink: context=yes delay=%ds freq_hz=%d", delaySec, item.TxInfo.Frequency)
		}
		uplinkSF := uint32(0)
		if tx := uplink.GetTxInfo(); tx != nil {
			if lora := tx.GetModulation().GetLora(); lora != nil {
				uplinkSF = lora.GetSpreadingFactor()
			}
		}
		bw, sf, cr := profile.RX1Modulation(uplinkSF)
		log.Printf("Class A downlink: uplink_sf=%d → rx1 sf=%d bw=%d cr=%s", uplinkSF, sf, bw, cr)
		item.TxInfo.Modulation = &gw.Modulation{
			Parameters: &gw.Modulation_Lora{
				Lora: &gw.LoraModulationInfo{
					Bandwidth:            bw,
					SpreadingFactor:      sf,
					CodeRate:             cr,
					PolarizationInversion: true, // LoRaWAN downlinks require inverted IQ
				},
			},
		}
	} else {
		// No Context in uplink: concentratord needs Context to schedule Class A RX1. We fall back to Immediately;
		// the gateway may still emit but timing can be wrong. Ensure concentratord sends RxInfo.Context in uplinks.
		log.Printf("downlink: uplink has no Context; using Immediately timing (Class A RX1 may miss window)")
		item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}},
		}
	}
	return df
}

func uplinkFrequency(uplink *gw.UplinkFrame) uint32 {
	if tx := uplink.GetTxInfo(); tx != nil && tx.GetFrequency() != 0 {
		return tx.GetFrequency()
	}
	if leg := uplink.GetTxInfoLegacy(); leg != nil && leg.GetFrequency() != 0 {
		return leg.GetFrequency()
	}
	return 0
}

// IsUS915UplinkFrequency returns true if freq is in the US915 uplink band (902.3–914.9 MHz).
func IsUS915UplinkFrequency(freqHz uint32) bool {
	return freqHz >= us915UplinkMinHz && freqHz <= us915UplinkMaxHz
}

// BuildImmediateDownlink builds a Class C downlink with Timing_Immediately on the RX2 channel.
// Used for EnqueueDownlink (API-triggered commands) to Class C devices.
func BuildImmediateDownlink(cfg *Config, profile RegionProfile, phyPayload []byte) *gw.DownlinkFrame {
	bw, sf, cr := profile.RX2Modulation()
	return &gw.DownlinkFrame{
		GatewayId: cfg.GatewayID,
		Items: []*gw.DownlinkFrameItem{{
			PhyPayload: phyPayload,
			TxInfo: &gw.DownlinkTxInfo{
				Frequency: profile.RX2FrequencyHz(),
				Timing: &gw.Timing{
					Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}},
				},
				Modulation: &gw.Modulation{
					Parameters: &gw.Modulation_Lora{
						Lora: &gw.LoraModulationInfo{
							Bandwidth:            bw,
							SpreadingFactor:      sf,
							CodeRate:             cr,
							PolarizationInversion: true,
						},
					},
				},
			},
		}},
	}
}

// LogDownlinkAck logs each downlink item whose status is not OK.
func LogDownlinkAck(ack *gw.DownlinkTxAck, label string) {
	if ack == nil {
		return
	}
	for i, item := range ack.GetItems() {
		if st := item.GetStatus(); st != gw.TxAckStatus_OK {
			log.Printf("downlink ack %s item %d: %s", label, i, st.String())
		}
	}
}

// DownlinkAckSummary returns the first item's status string, or "" if OK or empty.
func DownlinkAckSummary(ack *gw.DownlinkTxAck) string {
	if ack == nil || len(ack.GetItems()) == 0 {
		return ""
	}
	if st := ack.GetItems()[0].GetStatus(); st != gw.TxAckStatus_OK {
		return st.String()
	}
	return ""
}
