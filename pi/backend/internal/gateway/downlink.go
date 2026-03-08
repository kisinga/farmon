package gateway

import (
	"log"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"google.golang.org/protobuf/types/known/durationpb"
)

// BuildClassADownlink builds a DownlinkFrame for Class A (e.g. JoinAccept or data reply).
// profile is selected from cfg.Region (e.g. ProfileForRegion(cfg.Region)). Uses cfg.RX1DelaySec and profile for RX1 frequency and modulation.
func BuildClassADownlink(cfg *Config, profile RegionProfile, phyPayload []byte, uplink *gw.UplinkFrame) *gw.DownlinkFrame {
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
		delaySec := cfg.RX1DelaySec
		if delaySec < minRX1DelaySec {
			delaySec = minRX1DelaySec
		}
		if delaySec > maxRX1DelaySec {
			delaySec = maxRX1DelaySec
		}
		item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Delay{
				Delay: &gw.DelayTimingInfo{Delay: durationpb.New(time.Duration(delaySec) * time.Second)},
			},
		}
		uplinkFreqHz := uplinkFrequency(uplink)
		item.TxInfo.Frequency = profile.RX1FrequencyHz(uplinkFreqHz, cfg.RX1FrequencyHz)
		if item.TxInfo.Frequency == 0 {
			log.Printf("downlink: uplink has no frequency; set rx1_frequency_hz in gateway settings or fix concentratord event parsing")
		}
		bw, sf, cr := profile.RX1Modulation()
		item.TxInfo.Modulation = &gw.Modulation{
			Parameters: &gw.Modulation_Lora{
				Lora: &gw.LoraModulationInfo{
					Bandwidth:       bw,
					SpreadingFactor: sf,
					CodeRate:        cr,
				},
			},
		}
	} else {
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

// BuildImmediateDownlink builds a downlink with Timing_Immediately (e.g. for EnqueueDownlink data).
func BuildImmediateDownlink(cfg *Config, phyPayload []byte) *gw.DownlinkFrame {
	return &gw.DownlinkFrame{
		GatewayId: cfg.GatewayID,
		Items: []*gw.DownlinkFrameItem{{
			PhyPayload: phyPayload,
			TxInfo: &gw.DownlinkTxInfo{
				Timing: &gw.Timing{
					Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}},
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
