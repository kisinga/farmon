package gateway

import (
	"log"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"google.golang.org/protobuf/types/known/durationpb"
)

// BuildClassADownlink builds a DownlinkFrame for Class A (e.g. JoinAccept or data reply).
// Uses cfg.RX1DelaySec for scheduling; sets Context from uplink when present.
// If uplink has no context, falls back to Timing_Immediately.
func BuildClassADownlink(cfg *Config, phyPayload []byte, uplink *gw.UplinkFrame) *gw.DownlinkFrame {
	item := &gw.DownlinkFrameItem{PhyPayload: phyPayload, TxInfo: &gw.DownlinkTxInfo{}}
	df := &gw.DownlinkFrame{Items: []*gw.DownlinkFrameItem{item}}
	rx := uplink.GetRxInfo()
	if rx != nil && len(rx.GetContext()) > 0 {
		df.GatewayId = rx.GetGatewayId()
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
				Delay: &gw.DelayTimingInfo{
					Delay: durationpb.New(time.Duration(delaySec) * time.Second),
				},
			},
		}
		if cfg.RX1FrequencyHz != 0 {
			item.TxInfo.Frequency = cfg.RX1FrequencyHz
		} else if tx := uplink.GetTxInfo(); tx != nil && tx.GetFrequency() != 0 {
			item.TxInfo.Frequency = tx.GetFrequency()
		}
	} else {
		if rx != nil {
			df.GatewayId = rx.GetGatewayId()
		} else if cfg.GatewayID != "" {
			df.GatewayId = cfg.GatewayID
		}
		item.TxInfo.Timing = &gw.Timing{
			Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}},
		}
	}
	return df
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

// LogDownlinkAck logs each item status; logs at warning level if any item is not OK.
func LogDownlinkAck(ack *gw.DownlinkTxAck, label string) {
	if ack == nil {
		return
	}
	for i, item := range ack.GetItems() {
		st := item.GetStatus()
		name := st.String()
		if st != gw.TxAckStatus_OK {
			log.Printf("downlink ack %s item %d: %s", label, i, name)
		} else {
			log.Printf("downlink ack %s item %d: OK", label, i)
		}
	}
}

// DownlinkAckSummary returns a short status string for the first item (e.g. "OK" or "TOO_LATE").
// Use for RecordDownlink when status is not OK so the UI can show it.
func DownlinkAckSummary(ack *gw.DownlinkTxAck) string {
	if ack == nil || len(ack.GetItems()) == 0 {
		return ""
	}
	st := ack.GetItems()[0].GetStatus()
	if st == gw.TxAckStatus_OK {
		return ""
	}
	return st.String()
}
