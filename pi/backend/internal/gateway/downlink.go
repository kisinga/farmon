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
// The frame contains TWO items: RX1 (primary) and RX2 (fallback). Concentratord tries RX1 first;
// if it can't transmit (e.g. TOO_LATE because the command arrived after the RX1 deadline),
// it falls back to RX2 (which opens 1 second after RX1). This matches ChirpStack behavior.
func BuildClassADownlink(cfg *Config, profile RegionProfile, phyPayload []byte, uplink *gw.UplinkFrame, delaySec int) *gw.DownlinkFrame {
	rx1Item := &gw.DownlinkFrameItem{PhyPayload: phyPayload, TxInfo: &gw.DownlinkTxInfo{}}
	df := &gw.DownlinkFrame{Items: []*gw.DownlinkFrameItem{rx1Item}}
	rx := uplink.GetRxInfo()
	hasContext := rx != nil && len(rx.GetContext()) > 0

	if rx != nil {
		df.GatewayId = rx.GetGatewayId()
	}
	if df.GatewayId == "" {
		df.GatewayId = cfg.GatewayID
	}

	if hasContext {
		uplinkCtx := rx.GetContext()
		uplinkFreqHz := uplinkFrequency(uplink)
		uplinkSF := uint32(0)
		if tx := uplink.GetTxInfo(); tx != nil {
			if lora := tx.GetModulation().GetLora(); lora != nil {
				uplinkSF = lora.GetSpreadingFactor()
			}
		}

		// TX power: US915 max EIRP=30 dBm, antenna_gain=2 dBi → TX power = 27 dBm.
		// Leaving power=0 (protobuf default) may cause concentratord to use minimal TX power.
		txPower := int32(27)

		// --- RX1 item (primary) ---
		rx1Item.TxInfo.Context = uplinkCtx
		rx1Item.TxInfo.Power = txPower
		rx1Item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Delay{
				Delay: &gw.DelayTimingInfo{Delay: durationpb.New(time.Duration(delaySec) * time.Second)},
			},
		}
		rx1Item.TxInfo.Frequency = profile.RX1FrequencyHz(uplinkFreqHz, cfg.RX1FrequencyHz)
		rx1Bw, rx1Sf, rx1Cr := profile.RX1Modulation(uplinkSF)
		rx1Item.TxInfo.Modulation = &gw.Modulation{
			Parameters: &gw.Modulation_Lora{
				Lora: &gw.LoraModulationInfo{
					Bandwidth:             rx1Bw,
					SpreadingFactor:       rx1Sf,
					CodeRate:              rx1Cr,
					PolarizationInversion: true,
				},
			},
		}

		// --- RX2 item (fallback, +1s after RX1) ---
		rx2Bw, rx2Sf, rx2Cr := profile.RX2Modulation()
		rx2Item := &gw.DownlinkFrameItem{
			PhyPayload: phyPayload,
			TxInfo: &gw.DownlinkTxInfo{
				Context:   uplinkCtx,
				Power:     txPower,
				Frequency: profile.RX2FrequencyHz(),
				Timing: &gw.Timing{
					Parameters: &gw.Timing_Delay{
						Delay: &gw.DelayTimingInfo{Delay: durationpb.New(time.Duration(delaySec+1) * time.Second)},
					},
				},
				Modulation: &gw.Modulation{
					Parameters: &gw.Modulation_Lora{
						Lora: &gw.LoraModulationInfo{
							Bandwidth:             rx2Bw,
							SpreadingFactor:       rx2Sf,
							CodeRate:              rx2Cr,
							PolarizationInversion: true,
						},
					},
				},
			},
		}
		df.Items = append(df.Items, rx2Item)

		log.Printf("Class A downlink: delay=%ds power=%d uplink_freq=%d uplink_sf=%d | rx1_freq=%d rx1_sf=%d rx1_bw=%d | rx2_freq=%d rx2_sf=%d rx2_bw=%d",
			delaySec, txPower, uplinkFreqHz, uplinkSF,
			rx1Item.TxInfo.Frequency, rx1Sf, rx1Bw, rx2Item.TxInfo.Frequency, rx2Sf, rx2Bw)
	} else {
		// No Context in uplink: concentratord needs Context to schedule Class A RX1. We fall back to Immediately;
		// the gateway may still emit but timing can be wrong. Ensure concentratord sends RxInfo.Context in uplinks.
		log.Printf("downlink: uplink has no Context; using Immediately timing (Class A RX1 may miss window)")
		rx1Item.TxInfo.Timing = &gw.Timing{
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

// LogDownlinkAck logs each downlink item's status (RX1, RX2, etc).
func LogDownlinkAck(ack *gw.DownlinkTxAck, label string) {
	if ack == nil {
		return
	}
	windows := []string{"RX1", "RX2"}
	for i, item := range ack.GetItems() {
		win := "item"
		if i < len(windows) {
			win = windows[i]
		}
		st := item.GetStatus()
		if st != gw.TxAckStatus_OK {
			log.Printf("downlink ack %s %s: %s", label, win, st.String())
		} else {
			log.Printf("downlink ack %s %s: OK", label, win)
		}
	}
}

// DownlinkAckSummary returns a summary of which window was used. Returns "" if all OK or empty.
func DownlinkAckSummary(ack *gw.DownlinkTxAck) string {
	if ack == nil || len(ack.GetItems()) == 0 {
		return ""
	}
	windows := []string{"RX1", "RX2"}
	// Find the first OK item (that's the window that was used)
	for i, item := range ack.GetItems() {
		if item.GetStatus() == gw.TxAckStatus_OK {
			if i < len(windows) {
				return windows[i] + ":OK"
			}
			return "OK"
		}
	}
	// No OK item — return first non-OK status
	return ack.GetItems()[0].GetStatus().String()
}
