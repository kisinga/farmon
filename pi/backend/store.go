package main

import (
	"encoding/json"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func upsertDevice(app core.App, deviceEui, deviceName string, obj map[string]any) error {
	coll, err := app.FindCollectionByNameOrId("devices")
	if err != nil {
		return err
	}

	regJSON := "{}"
	if obj != nil {
		b, _ := json.Marshal(obj)
		regJSON = string(b)
	}

	existing, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": deviceEui})
	if err != nil {
		// Create new
		rec := core.NewRecord(coll)
		rec.Set("device_eui", deviceEui)
		rec.Set("device_name", deviceName)
		rec.Set("registration", regJSON)
		rec.Set("last_seen", time.Now().Format(time.RFC3339))
		return app.Save(rec)
	}

	existing.Set("device_name", deviceName)
	existing.Set("last_seen", time.Now().Format(time.RFC3339))
	if obj != nil {
		existing.Set("registration", regJSON)
	}
	return app.Save(existing)
}

func insertTelemetry(app core.App, deviceEui string, data map[string]any, rssi *int, snr *float64) error {
	coll, err := app.FindCollectionByNameOrId("telemetry")
	if err != nil {
		return err
	}

	dataJSON := "{}"
	if data != nil {
		b, _ := json.Marshal(data)
		dataJSON = string(b)
	}

	rec := core.NewRecord(coll)
	rec.Set("device_eui", deviceEui)
	rec.Set("data", dataJSON)
	if rssi != nil {
		rec.Set("rssi", *rssi)
	}
	if snr != nil {
		rec.Set("snr", *snr)
	}
	rec.Set("ts", time.Now().Format(time.RFC3339))
	return app.Save(rec)
}

func insertStateChange(app core.App, deviceEui, controlKey, oldState, newState, reason string, deviceTs time.Time) error {
	coll, err := app.FindCollectionByNameOrId("state_changes")
	if err != nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("device_eui", deviceEui)
	rec.Set("control_key", controlKey)
	rec.Set("old_state", oldState)
	rec.Set("new_state", newState)
	rec.Set("reason", reason)
	if !deviceTs.IsZero() {
		rec.Set("device_ts", deviceTs.Format(time.RFC3339))
	}
	rec.Set("ts", time.Now().Format(time.RFC3339))
	return app.Save(rec)
}

func upsertDeviceControl(app core.App, deviceEui, controlKey, currentState, changedBy string) error {
	coll, err := app.FindCollectionByNameOrId("device_controls")
	if err != nil {
		return err
	}
	now := time.Now().Format(time.RFC3339)
	existing, err := app.FindFirstRecordByFilter("device_controls", "device_eui = {:eui} && control_key = {:key}", dbx.Params{"eui": deviceEui, "key": controlKey})
	if err != nil {
		rec := core.NewRecord(coll)
		rec.Set("device_eui", deviceEui)
		rec.Set("control_key", controlKey)
		rec.Set("current_state", currentState)
		rec.Set("last_change_at", now)
		rec.Set("last_change_by", changedBy)
		return app.Save(rec)
	}
	existing.Set("current_state", currentState)
	existing.Set("last_change_at", now)
	existing.Set("last_change_by", changedBy)
	return app.Save(existing)
}

func insertFirmwareProgress(app core.App, deviceEui string, status int, chunkIndex int, outcome string) error {
	coll, err := app.FindCollectionByNameOrId("firmware_history")
	if err != nil {
		return err
	}
	rec := core.NewRecord(coll)
	rec.Set("device_eui", deviceEui)
	rec.Set("started_at", time.Now().Format(time.RFC3339))
	rec.Set("outcome", outcome)
	if chunkIndex >= 0 {
		rec.Set("chunks_received", chunkIndex)
	}
	return app.Save(rec)
}

// insertCommand logs a user-initiated downlink command to the persistent commands collection.
func insertCommand(app core.App, deviceEui, commandKey, initiatedBy, status string, payload map[string]any) {
	coll, err := app.FindCollectionByNameOrId("commands")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("device_eui", deviceEui)
	rec.Set("command_key", commandKey)
	rec.Set("initiated_by", initiatedBy)
	rec.Set("status", status)
	rec.Set("sent_at", time.Now().Format(time.RFC3339))
	if payload != nil {
		b, _ := json.Marshal(payload)
		rec.Set("payload", string(b))
	}
	_ = app.Save(rec)
}

// HistoryPoint is one (ts, value) for getTelemetryHistory response.
type HistoryPoint struct {
	Ts    string  `json:"ts"`
	Value float64 `json:"value"`
}

// GetTelemetryHistory returns time-series for one field (telemetry data key or "rssi"/"snr").
// Filter: device_eui, optional ts >= from and ts <= to. Limit 500. Sort ts asc.
func GetTelemetryHistory(app core.App, deviceEui, field, from, to string, limit int) ([]HistoryPoint, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	filter := "device_eui = {:eui}"
	params := dbx.Params{"eui": deviceEui}
	if from != "" {
		filter += " && ts >= {:from}"
		params["from"] = from
	}
	if to != "" {
		filter += " && ts <= {:to}"
		params["to"] = to
	}
	records, err := app.FindRecordsByFilter("telemetry", filter, "ts", limit, 0, params)
	if err != nil {
		return nil, err
	}
	out := make([]HistoryPoint, 0, len(records))
	for _, rec := range records {
		ts, _ := rec.Get("ts").(string)
		if ts == "" {
			continue
		}
		var val float64
		switch field {
		case "rssi":
			if v, ok := rec.Get("rssi").(float64); ok {
				val = v
			} else if v, ok := rec.Get("rssi").(int); ok {
				val = float64(v)
			}
		case "snr":
			if v, ok := rec.Get("snr").(float64); ok {
				val = v
			}
		default:
			dataRaw := rec.Get("data")
			if dataRaw == nil {
				continue
			}
			dataStr, ok := dataRaw.(string)
			if !ok {
				continue
			}
			var data map[string]any
			if json.Unmarshal([]byte(dataStr), &data) != nil {
				continue
			}
			if v, ok := data[field]; ok {
				switch n := v.(type) {
				case float64:
					val = n
				case int:
					val = float64(n)
				case int64:
					val = float64(n)
				}
			} else {
				continue
			}
		}
		out = append(out, HistoryPoint{Ts: ts, Value: val})
	}
	return out, nil
}
