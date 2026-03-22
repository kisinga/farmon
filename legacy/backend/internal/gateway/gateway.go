package gateway

import (
	"context"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
)

// UplinkSource delivers uplink and stats events (e.g. from Concentratord ZMQ SUB) to the pipeline.
// Caller typically runs a goroutine that receives frames and calls the callbacks for each.
type UplinkSource interface {
	// Run blocks and delivers *gw.UplinkFrame via onUplink and *gw.GatewayStats via onStats (if non-nil) until ctx is done.
	Run(ctx context.Context, onUplink func(*gw.UplinkFrame), onStats func(*gw.GatewayStats)) error
}

// DownlinkSender sends downlink frames (e.g. via Concentratord ZMQ REQ) and returns the TX ack.
type DownlinkSender interface {
	// SendDownlink sends the frame and returns the gateway's DownlinkTxAck (or error).
	SendDownlink(ctx context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error)
}
