package gateway

import (
	"log"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"google.golang.org/protobuf/types/known/durationpb"
)

// US915 band (RX1 downlink is in 923 MHz band, not uplink frequency).
// Uplink: 902.3–914.9 MHz (125 kHz channels, 200 kHz step); Downlink: 923.3–927.5 MHz (8 channels, 600 kHz step).
// RX1 channel = uplink_channel % 8.
const (
	us915UplinkBaseHz   uint32 = 902300000
	us915UplinkStepHz   uint32 = 200000
	us915UplinkMaxHz    uint32 = 914900000
	us915DownlinkBaseHz uint32 = 923300000
	us915DownlinkStepHz uint32 = 600000
	us915NumUplinkCh    uint32 = 64
)

// BuildClassADownlink builds a DownlinkFrame for Class A (e.g. JoinAccept or data reply).
// Uses cfg.RX1DelaySec for scheduling; sets Context from uplink when present.
func BuildClassADownlink(cfg *Config, phyPayload []byte, uplink *gw.UplinkFrame) *gw.DownlinkFrame {
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
		item.TxInfo.Frequency = rx1FrequencyHz(cfg, uplink)
		if item.TxInfo.Frequency == 0 {
			log.Printf("downlink: uplink has no frequency; set CONCENTRATORD_RX1_FREQUENCY_HZ or fix concentratord event parsing")
		}
		// US915 RX1: device listens at DR8 (SF12, 500 kHz). Set modulation so gateway TX matches.
		if isUS915DownlinkFreq(item.TxInfo.Frequency) {
			item.TxInfo.Modulation = &gw.Modulation{
				Parameters: &gw.Modulation_Lora{
					Lora: &gw.LoraModulationInfo{
						Bandwidth:       500000,
						SpreadingFactor: 12,
						CodeRate:        gw.CodeRate_CR_4_5, // LoRaWAN default; required by SX1302 HAL for TX
					},
				},
			}
		}
	} else {
		item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}},
		}
	}
	return df
}

func rx1FrequencyHz(cfg *Config, uplink *gw.UplinkFrame) uint32 {
	if cfg.RX1FrequencyHz != 0 {
		return cfg.RX1FrequencyHz
	}
	var uplinkFreqHz uint32
	if tx := uplink.GetTxInfo(); tx != nil && tx.GetFrequency() != 0 {
		uplinkFreqHz = tx.GetFrequency()
	} else if leg := uplink.GetTxInfoLegacy(); leg != nil && leg.GetFrequency() != 0 {
		uplinkFreqHz = leg.GetFrequency()
	}
	if uplinkFreqHz == 0 {
		return 0
	}
	// US915: device listens for RX1 in 923 MHz band. Gateway has only one lora_std (923.3 MHz); pushing 8 downlink channels crashes concentratord ("channels do not fit within the bandwidth of the two radios"). Use 923.3 only.
	if uplinkFreqHz >= us915UplinkBaseHz && uplinkFreqHz <= us915UplinkMaxHz {
		return us915DownlinkBaseHz // 923.3 MHz — matches single lora_std in static config
	}
	// EU868 etc.: RX1 uses same frequency as uplink.
	return uplinkFreqHz
}

// isUS915DownlinkFreq returns true if freq is in the US915 RX1 downlink band (923.3–927.5 MHz).
func isUS915DownlinkFreq(freqHz uint32) bool {
	return freqHz >= us915DownlinkBaseHz && freqHz <= us915DownlinkBaseHz+7*us915DownlinkStepHz
}

// IsUS915UplinkFrequency returns true if freq is in the US915 uplink band (902.3–914.9 MHz).
func IsUS915UplinkFrequency(freqHz uint32) bool {
	return freqHz >= us915UplinkBaseHz && freqHz <= us915UplinkMaxHz
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
