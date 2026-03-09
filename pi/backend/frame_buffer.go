package main

import (
	"encoding/hex"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const maxFrames = 500

const lorawanFramesCollectionName = "lorawan_frames"

// ensureLorawanFramesCollection creates the lorawan_frames collection if it does not exist.
// Called on serve so the collection exists even when JS migrations have not run (e.g. deploy without pb_migrations).
func ensureLorawanFramesCollection(app core.App) {
	_, err := app.FindCollectionByNameOrId(lorawanFramesCollectionName)
	if err == nil {
		return
	}
	col := core.NewBaseCollection(lorawanFramesCollectionName)
	col.ListRule = nil
	col.ViewRule = nil
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	col.Fields.Add(
		&core.TextField{Name: "time"},
		&core.TextField{Name: "direction"},
		&core.TextField{Name: "dev_eui"},
		&core.NumberField{Name: "f_port"},
		&core.TextField{Name: "kind"},
		&core.TextField{Name: "payload_hex"},
		&core.NumberField{Name: "phy_len"},
		&core.NumberField{Name: "rssi"},
		&core.NumberField{Name: "snr"},
		&core.TextField{Name: "gateway_id"},
		&core.TextField{Name: "error"},
	)
	if err := app.Save(col); err != nil {
		log.Printf("ensure lorawan_frames collection: %v", err)
		return
	}
	log.Printf("created %s collection (JS migration may not have run)", lorawanFramesCollectionName)
}

// RawFrame is a single LoRaWAN frame record for the monitoring UI.
type RawFrame struct {
	Time       string   `json:"time"`        // RFC3339
	Direction  string   `json:"direction"`  // "up" | "down"
	DevEUI     string   `json:"dev_eui"`     // empty for join request before decode
	FPort      uint8    `json:"f_port"`
	Kind       string   `json:"kind"`        // "join" | "data" | "join_accept"
	PayloadHex string   `json:"payload_hex"`
	PhyLen     int      `json:"phy_len"`
	RSSI       *int     `json:"rssi,omitempty"`
	SNR        *float64 `json:"snr,omitempty"`
	GatewayID  string   `json:"gateway_id,omitempty"`
	Error      string   `json:"error,omitempty"` // downlink send error
}

// WriteFrame inserts a frame into the lorawan_frames collection and triggers lazy trim.
// If app is nil, the call is a no-op (for tests or before DB is ready).
func WriteFrame(app core.App, f RawFrame) error {
	if app == nil {
		return nil
	}
	coll, err := app.FindCollectionByNameOrId("lorawan_frames")
	if err != nil || coll == nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("time", f.Time)
	rec.Set("direction", f.Direction)
	rec.Set("dev_eui", f.DevEUI)
	rec.Set("f_port", int(f.FPort))
	rec.Set("kind", f.Kind)
	rec.Set("payload_hex", f.PayloadHex)
	rec.Set("phy_len", f.PhyLen)
	if f.RSSI != nil {
		rec.Set("rssi", *f.RSSI)
	}
	if f.SNR != nil {
		rec.Set("snr", *f.SNR)
	}
	rec.Set("gateway_id", f.GatewayID)
	rec.Set("error", f.Error)
	if err := app.Save(rec); err != nil {
		return err
	}
	go trimLorawanFramesIfNeeded(app)
	return nil
}

// trimLorawanFramesIfNeeded deletes oldest records when count exceeds maxFrames. Lazy, no transaction.
// Fetches oldest first (sort "created" asc); if more than maxFrames, deletes the excess.
func trimLorawanFramesIfNeeded(app core.App) {
	records, err := app.FindRecordsByFilter("lorawan_frames", "", "created", maxFrames+200, 0, nil)
	if err != nil || len(records) <= maxFrames {
		return
	}
	toDelete := len(records) - maxFrames
	for i := 0; i < toDelete; i++ {
		if err := app.Delete(records[i]); err != nil {
			log.Printf("lorawan_frames trim delete: %v", err)
			return
		}
	}
}

// RecordUplink adds an uplink to the lorawan_frames collection (call from pipeline). Pass app from pipeline.
func RecordUplink(app core.App, devEUI string, fPort uint8, kind string, payload []byte, phyLen int, rssi *int, snr *float64, gatewayID string) {
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
	_ = WriteFrame(app, f)
}

// RecordUplinkDecodeFailed persists a raw uplink when ProcessUplink fails (unknown device, MIC error, etc.) so frames appear in the monitor.
func RecordUplinkDecodeFailed(app core.App, phyRaw []byte, rssi *int, snr *float64, gatewayID, decodeError string) {
	f := RawFrame{
		Time:       time.Now().UTC().Format(time.RFC3339),
		Direction:  "up",
		DevEUI:     "",
		FPort:      0,
		Kind:       "decode_failed",
		PayloadHex: hex.EncodeToString(phyRaw),
		PhyLen:     len(phyRaw),
		RSSI:       rssi,
		SNR:        snr,
		GatewayID:  gatewayID,
		Error:      decodeError,
	}
	_ = WriteFrame(app, f)
}

// RecordDownlink adds a downlink to the lorawan_frames collection (call from EnqueueDownlink / pipeline). Pass app.
func RecordDownlink(app core.App, devEUI string, fPort uint8, kind string, payload []byte, phyLen int, errMsg string) {
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
	_ = WriteFrame(app, f)
}

// FrameStats holds aggregate counts for the monitor.
type FrameStats struct {
	TotalUplinks   int `json:"total_uplinks"`
	TotalDownlinks int `json:"total_downlinks"`
	BufferSize     int `json:"buffer_size"`
}

// GetFrameStatsFromDB returns frame counts from the lorawan_frames collection. Used by lorawanStatsHandler.
func GetFrameStatsFromDB(app core.App) FrameStats {
	if app == nil {
		return FrameStats{}
	}
	records, err := app.FindRecordsByFilter("lorawan_frames", "", "-created", maxFrames*2, 0, nil)
	if err != nil {
		return FrameStats{}
	}
	var up, down int
	for _, rec := range records {
		d, _ := rec.Get("direction").(string)
		if d == "up" {
			up++
		} else {
			down++
		}
	}
	return FrameStats{
		TotalUplinks:   up,
		TotalDownlinks: down,
		BufferSize:     len(records),
	}
}
