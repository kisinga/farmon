package main

import (
	"log"
	"strconv"
	"time"

	"github.com/kisinga/farmon/pi/internal/gateway"
	"github.com/pocketbase/pocketbase/core"
)

// Package-level registration assembler (singleton, thread-safe).
var regAssembler = NewRegistrationAssembler()

// handleUplinkFromPipeline persists decoded uplink: device upsert, telemetry, state changes, OTA progress.
// cfg and downlinkSender are used for sending registration ACK downlinks.
func handleUplinkFromPipeline(app core.App, devEui, deviceName string, fPort uint8, obj map[string]any, rssi *int, snr *float64, cfg *gateway.Config) error {
	if deviceName == "" {
		deviceName = devEui
	}
	if err := upsertDevice(app, devEui, deviceName, obj); err != nil {
		return err
	}
	if obj == nil {
		obj = make(map[string]any)
	}
	switch fPort {
	case 1:
		frameKey, _ := obj["frameKey"].(string)
		frameData, _ := obj["frameData"].(string)
		if frameKey != "" {
			if complete := regAssembler.Accumulate(devEui, frameKey, frameData); complete {
				frames := regAssembler.Consume(devEui)
				if err := processRegistration(app, devEui, frames); err != nil {
					log.Printf("registration: processRegistration error dev_eui=%s: %v", devEui, err)
				} else {
					// Send registration ACK on fPort 5 (empty payload)
					if cfg != nil && cfg.Valid() {
						go func() {
							if err := EnqueueDownlink(cfg, app, devEui, 5, []byte{0x01}); err != nil {
								log.Printf("registration: ACK downlink error dev_eui=%s: %v", devEui, err)
							} else {
								log.Printf("registration: ACK sent dev_eui=%s", devEui)
							}
						}()
					}
				}
			}
		}
	case 2:
		if err := insertTelemetry(app, devEui, obj, rssi, snr); err != nil {
			return err
		}
	case 3:
		if sc, ok := obj["stateChanges"].([]any); ok {
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
				controlKey := lookupControlKey(app, devEui, int(ctrlIdx))
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
	case 8:
		if status, ok := obj["status"]; ok {
			chunkIdx, _ := obj["chunkIndex"].(float64)
			outcome := "started"
			if s, _ := status.(float64); s == 2 {
				outcome = "done"
			} else if s, _ := status.(float64); s == 3 {
				outcome = "failed"
			}
			_ = insertFirmwareProgress(app, devEui, int(getFloat64(status)), int(chunkIdx), outcome)
		}
	default:
		_ = insertTelemetry(app, devEui, obj, rssi, snr)
	}
	return nil
}

func getFloat64(v interface{}) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	if i, ok := v.(int); ok {
		return float64(i)
	}
	return 0
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
