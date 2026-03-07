package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ChirpStack HTTP integration sends POST with ?event=up|join|ack|... and JSON body.
// We use inline structs matching ChirpStack JSON (deviceInfo, rxInfo, object from codec).

type deviceInfo struct {
	TenantID          string `json:"tenantId"`
	ApplicationID     string `json:"applicationId"`
	DeviceProfileID   string `json:"deviceProfileId"`
	DeviceName        string `json:"deviceName"`
	DevEui            string `json:"devEui"`
}

type rxInfoEntry struct {
	GatewayId string  `json:"gatewayId"`
	Rssi      int32   `json:"rssi"`
	Snr       float64 `json:"snr"`
}

type uplinkPayload struct {
	DeviceInfo *deviceInfo    `json:"deviceInfo"`
	FPort      uint32         `json:"fPort"`
	Data       string         `json:"data"` // base64 raw bytes (we use Object when codec decoded)
	RxInfo     []rxInfoEntry  `json:"rxInfo"`
	Object     map[string]any `json:"object"` // decoded by ChirpStack codec
}

func chirpstackHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		event := e.Request.URL.Query().Get("event")
		if event == "" {
			return e.String(http.StatusBadRequest, "missing event query param")
		}

		body, err := io.ReadAll(e.Request.Body)
		if err != nil || len(body) == 0 {
			return e.String(http.StatusBadRequest, "empty or unreadable body")
		}

		switch event {
		case "up":
			var up uplinkPayload
			if err := json.Unmarshal(body, &up); err != nil {
				return e.String(http.StatusBadRequest, "invalid JSON: "+err.Error())
			}
			return handleUplink(app, e, &up)
		case "join":
			// optional: update device join state
			return e.String(http.StatusOK, "")
		default:
			return e.String(http.StatusOK, "")
		}
	}
}

func handleUplink(app core.App, e *core.RequestEvent, up *uplinkPayload) error {
	if up.DeviceInfo == nil || up.DeviceInfo.DevEui == "" {
		return e.String(http.StatusBadRequest, "missing deviceInfo.devEui")
	}

	devEui := normalizeEui(up.DeviceInfo.DevEui)
	deviceName := up.DeviceInfo.DeviceName
	if deviceName == "" {
		deviceName = devEui
	}

	// Ensure device record exists (upsert)
	if err := upsertDevice(app, devEui, deviceName, up.Object); err != nil {
		return e.String(http.StatusInternalServerError, err.Error())
	}

	rssi, snr := rxMetrics(up.RxInfo)

	switch up.FPort {
	case 1:
		// Registration: device already upserted with object
		// Optional: parse registration frames and write device_fields/device_controls (Phase 2.2 full)
	case 2:
		// Telemetry
		if err := insertTelemetry(app, devEui, up.Object, rssi, snr); err != nil {
			return e.String(http.StatusInternalServerError, err.Error())
		}
	case 3:
		// State change(s): object.stateChanges array
		if up.Object != nil {
			if sc, ok := up.Object["stateChanges"].([]any); ok {
				for _, v := range sc {
					m, _ := v.(map[string]any)
					if m == nil {
						continue
					}
					ctrlIdx, _ := m["control_idx"].(float64)
					newState, _ := m["new_state"].(float64)
					oldState, _ := m["old_state"].(float64)
					source, _ := m["source"].(string)
					deviceMs, _ := m["device_ms"].(float64)
					controlKey := formatControlKey(int(ctrlIdx))
					newS := formatState(int(newState))
					oldS := formatState(int(oldState))
					var deviceTs time.Time
					if deviceMs > 0 {
						deviceTs = time.Unix(0, int64(deviceMs)*int64(time.Millisecond))
					}
					_ = insertStateChange(app, devEui, controlKey, oldS, newS, source, deviceTs)
					_ = upsertDeviceControl(app, devEui, controlKey, newS, source)
				}
			}
		}
	case 4:
		// Command ACK: optional update commands table
	case 8:
		// OTA progress: status (1B), chunkIndex (2B LE) in object or data
		if up.Object != nil {
			status, _ := up.Object["status"].(float64)
			chunkIdx, _ := up.Object["chunkIndex"].(float64)
			outcome := "started"
			if status == 2 {
				outcome = "done"
			} else if status == 3 {
				outcome = "failed"
			}
			_ = insertFirmwareProgress(app, devEui, int(status), int(chunkIdx), outcome)
		}
	default:
		// Store as telemetry if decoded object present
		if up.Object != nil {
			_ = insertTelemetry(app, devEui, up.Object, rssi, snr)
		}
	}

	return e.String(http.StatusOK, "")
}

func formatControlKey(idx int) string {
	if idx == 0 {
		return "pump"
	}
	if idx == 1 {
		return "valve"
	}
	return "control_" + strconv.Itoa(idx)
}

func formatState(idx int) string {
	if idx == 0 {
		return "off"
	}
	return "on"
}

func rxMetrics(rx []rxInfoEntry) (rssi *int, snr *float64) {
	if len(rx) == 0 {
		return nil, nil
	}
	r := int(rx[0].Rssi)
	s := rx[0].Snr
	return &r, &s
}

func normalizeEui(eui string) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 16)
	for _, c := range eui {
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			out = append(out, byte(c))
		} else if c >= 'A' && c <= 'F' {
			out = append(out, byte(c-'A'+'a'))
		}
	}
	if len(out) > 16 {
		out = out[:16]
	}
	return string(out)
}
