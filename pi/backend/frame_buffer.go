package main

import (
	"encoding/hex"
	"sync"
	"time"
)

const maxFrames = 500

// RawFrame is a single LoRaWAN frame record for the monitoring UI.
type RawFrame struct {
	Time       string  `json:"time"`        // RFC3339
	Direction  string  `json:"direction"`   // "up" | "down"
	DevEUI     string  `json:"dev_eui"`      // empty for join request before decode
	FPort      uint8   `json:"f_port"`
	Kind       string  `json:"kind"`        // "join" | "data" | "join_accept"
	PayloadHex string  `json:"payload_hex"`
	PhyLen     int     `json:"phy_len"`
	RSSI       *int    `json:"rssi,omitempty"`
	SNR        *float64 `json:"snr,omitempty"`
	GatewayID  string  `json:"gateway_id,omitempty"`
	Error      string  `json:"error,omitempty"` // downlink send error
}

var (
	frameBuf  [maxFrames]RawFrame
	frameNext int // next write index (ring)
	frameBufMu sync.RWMutex
)

func init() {
	// frameBuf is zero-valued
}

// RecordUplink adds an uplink to the ring buffer (call from pipeline).
func RecordUplink(devEUI string, fPort uint8, kind string, payload []byte, phyLen int, rssi *int, snr *float64, gatewayID string) {
	frameBufMu.Lock()
	defer frameBufMu.Unlock()
	f := RawFrame{
		Time:       time.Now().UTC().Format(time.RFC3339),
		Direction:  "up",
		DevEUI:     devEUI,
		FPort:      fPort,
		Kind:       kind,
		PayloadHex: hex.EncodeToString(payload),
		PhyLen:     phyLen,
		RSSI:       rssi,
		SNR:        snr,
		GatewayID:  gatewayID,
	}
	appendFrameLocked(f)
}

// RecordDownlink adds a downlink to the ring buffer (call from EnqueueDownlink / pipeline).
func RecordDownlink(devEUI string, fPort uint8, kind string, payload []byte, phyLen int, errMsg string) {
	frameBufMu.Lock()
	defer frameBufMu.Unlock()
	f := RawFrame{
		Time:       time.Now().UTC().Format(time.RFC3339),
		Direction:  "down",
		DevEUI:     devEUI,
		FPort:      fPort,
		Kind:       kind,
		PayloadHex: hex.EncodeToString(payload),
		PhyLen:     phyLen,
		Error:      errMsg,
	}
	appendFrameLocked(f)
}

func appendFrameLocked(f RawFrame) {
	frameBuf[frameNext%maxFrames] = f
	frameNext++
}

// GetFrames returns the most recent frames (newest first). limit caps the count.
func GetFrames(limit int) []RawFrame {
	frameBufMu.RLock()
	defer frameBufMu.RUnlock()
	n := frameNext
	if n == 0 {
		return nil
	}
	if n > maxFrames {
		n = maxFrames
	}
	if limit <= 0 || limit > maxFrames {
		limit = maxFrames
	}
	if n < limit {
		limit = n
	}
	out := make([]RawFrame, limit)
	// Newest at (frameNext-1)%maxFrames, then going backwards.
	for i := 0; i < limit; i++ {
		idx := (frameNext - 1 - i + maxFrames*2) % maxFrames
		out[i] = frameBuf[idx]
	}
	return out
}

// ClearFrames removes all stored frames (for UI "clear" action).
func ClearFrames() {
	frameBufMu.Lock()
	defer frameBufMu.Unlock()
	frameNext = 0
}

// FrameStats holds aggregate counts for the monitor.
type FrameStats struct {
	TotalUplinks   int `json:"total_uplinks"`
	TotalDownlinks int `json:"total_downlinks"`
	BufferSize     int `json:"buffer_size"`
}

// GetFrameStats returns current buffer size and counts.
func GetFrameStats() FrameStats {
	frameBufMu.RLock()
	defer frameBufMu.RUnlock()
	n := frameNext
	if n > maxFrames {
		n = maxFrames
	}
	var up, down int
	for i := 0; i < n; i++ {
		idx := (frameNext - 1 - i + maxFrames*2) % maxFrames
		if frameBuf[idx].Direction == "up" {
			up++
		} else {
			down++
		}
	}
	return FrameStats{
		TotalUplinks:   up,
		TotalDownlinks: down,
		BufferSize:     n,
	}
}
