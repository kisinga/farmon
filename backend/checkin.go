package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/kisinga/farmon/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// CheckinPayload represents the 14-byte device checkin on fPort 1.
// Layout: fw_major(1) | fw_minor(1) | fw_patch(1) | config_hash(4 LE) | preset_id(1) | uptime_sec(4 LE) | flags(2 LE)
type CheckinPayload struct {
	FWMajor    uint8
	FWMinor    uint8
	FWPatch    uint8
	ConfigHash uint32
	PresetID   uint8
	UptimeSec  uint32
	Flags      uint16
}

const checkinPayloadSize = 14

// parseCheckin parses the 14-byte binary checkin payload.
func parseCheckin(data []byte) (*CheckinPayload, error) {
	if len(data) < checkinPayloadSize {
		return nil, fmt.Errorf("checkin payload too short: %d bytes (need %d)", len(data), checkinPayloadSize)
	}
	return &CheckinPayload{
		FWMajor:    data[0],
		FWMinor:    data[1],
		FWPatch:    data[2],
		ConfigHash: binary.LittleEndian.Uint32(data[3:7]),
		PresetID:   data[7],
		UptimeSec:  binary.LittleEndian.Uint32(data[8:12]),
		Flags:      binary.LittleEndian.Uint16(data[12:14]),
	}, nil
}

// handleDeviceCheckin processes a fPort 1 checkin: updates device metadata,
// compares config_hash, queues AirConfig push on mismatch, and fires checkin workflows.
func handleDeviceCheckin(app core.App, cfg *gateway.Config, devEUI string, payload []byte) error {
	checkin, err := parseCheckin(payload)
	if err != nil {
		return err
	}

	fwVersion := fmt.Sprintf("%d.%d.%d", checkin.FWMajor, checkin.FWMinor, checkin.FWPatch)
	deviceHash := fmt.Sprintf("%08x", checkin.ConfigHash)

	log.Printf("[checkin] dev_eui=%s fw=%s hash=%s uptime=%ds preset=%d flags=0x%04x",
		devEUI, fwVersion, deviceHash, checkin.UptimeSec, checkin.PresetID, checkin.Flags)

	// Update device record
	dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return fmt.Errorf("device not found: %s", devEUI)
	}

	dev.Set("firmware_version", fwVersion)
	dev.Set("last_seen", time.Now().Format(time.RFC3339))

	configStatus := "n/a"

	// Load device-level airconfig for hash comparison
	deviceAC, acErr := loadDeviceAirConfig(app, devEUI)
	if acErr == nil && deviceAC != nil {
		expectedHash := computeConfigHash(deviceAC)
		if deviceHash == expectedHash {
			dev.Set("config_hash", deviceHash)
			configStatus = "synced"
			log.Printf("[checkin] dev_eui=%s config synced (hash=%s)", devEUI, deviceHash)
		} else {
			configStatus = "pending"
			log.Printf("[checkin] dev_eui=%s config mismatch: device=%s expected=%s — queuing push",
				devEUI, deviceHash, expectedHash)
			if cfg != nil {
				go func() {
					if pushErr := pushAirConfig(app, cfg, devEUI, deviceAC); pushErr != nil {
						log.Printf("[checkin] pushAirConfig error dev_eui=%s: %v", devEUI, pushErr)
					}
				}()
			}
		}
	}

	dev.Set("config_status", configStatus)
	if err := app.Save(dev); err != nil {
		return err
	}

	// Fire checkin workflows (non-blocking).
	if workflowEngine != nil {
		go workflowEngine.Evaluate(TriggerContext{
			Type:            TriggerCheckin,
			DeviceEUI:       devEUI,
			DeviceName:      dev.GetString("device_name"),
			UptimeSec:       checkin.UptimeSec,
			FirmwareVersion: fwVersion,
			IsBoot:          checkin.UptimeSec < 60,
			ConfigStatus:    configStatus,
		})
	}

	return nil
}

// pushAirConfig builds AirConfig subcommand payloads from the effective profile config
// and enqueues each as a fPort 35 downlink. Payloads are delivered over successive
// uplinks (one per Class A RX window) in priority order:
// pin_map → sensors (per slot) → controls (per slot) → lorawan.
func pushAirConfig(app core.App, cfg *gateway.Config, devEUI string, effective *AirConfig) error {
	log.Printf("[airconfig] building push for dev_eui=%s hash=%s", devEUI, computeConfigHash(effective))

	// 1. PinMap: [0x01, idx0, fn0, idx1, fn1, ...]
	if len(effective.PinMap) > 0 {
		var pins []float64
		if err := json.Unmarshal(effective.PinMap, &pins); err == nil && len(pins) > 0 {
			payload := make([]byte, 0, 1+len(pins)*2)
			payload = append(payload, 0x01)
			for idx, fn := range pins {
				payload = append(payload, byte(idx), byte(fn))
			}
			if err := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, payload); err != nil {
				return fmt.Errorf("pushAirConfig pin_map: %w", err)
			}
		}
	}

	// 2. Sensors: [0x04, slot, type, pin_idx, field_idx, flags, p1lo, p1hi, p2lo, p2hi]
	if len(effective.Sensors) > 0 {
		var sensors []map[string]any
		if err := json.Unmarshal(effective.Sensors, &sensors); err == nil {
			for slot, s := range sensors {
				p1 := uint16(toAnyFloat64(s["param1"]))
				p2 := uint16(toAnyFloat64(s["param2"]))
				payload := []byte{
					0x04,
					byte(slot),
					byte(toAnyFloat64(s["type"])),
					byte(toAnyFloat64(s["pin_index"])),
					byte(toAnyFloat64(s["field_index"])),
					byte(toAnyFloat64(s["flags"])),
					byte(p1 & 0xFF), byte(p1 >> 8),
					byte(p2 & 0xFF), byte(p2 >> 8),
				}
				if err := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, payload); err != nil {
					return fmt.Errorf("pushAirConfig sensor slot %d: %w", slot, err)
				}
			}
		}
	}

	// 3. Controls: [0x05, slot, pin_idx, state_count, flags, actuator_type, pin2_idx, pulse_x100ms]
	if len(effective.Controls) > 0 {
		var controls []map[string]any
		if err := json.Unmarshal(effective.Controls, &controls); err == nil {
			for slot, c := range controls {
				pin2 := byte(toAnyFloat64(c["pin2_index"]))
				if pin2 == 0 {
					pin2 = 0xFF // unused
				}
				payload := []byte{
					0x05,
					byte(slot),
					byte(toAnyFloat64(c["pin_index"])),
					byte(toAnyFloat64(c["state_count"])),
					byte(toAnyFloat64(c["flags"])),
					byte(toAnyFloat64(c["actuator_type"])),
					pin2,
					byte(toAnyFloat64(c["pulse_x100ms"])),
				}
				if err := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, payload); err != nil {
					return fmt.Errorf("pushAirConfig control slot %d: %w", slot, err)
				}
			}
		}
	}

	// 4. Transfer FSM config: [0x08, enabled, pump_ctrl, valve_t1, valve_t2, sv_ctrl,
	//                          level_t1_field, level_t2_field, start_delta_pct, stop_t1_min_pct, measure_pulse_sec]
	if len(effective.Transfer) > 0 {
		var t map[string]any
		if err := json.Unmarshal(effective.Transfer, &t); err == nil {
			payload := []byte{
				0x08,
				byte(toAnyFloat64(t["enabled"])),
				byte(toAnyFloat64(t["pump_ctrl"])),
				byte(toAnyFloat64(t["valve_t1_ctrl"])),
				byte(toAnyFloat64(t["valve_t2_ctrl"])),
				byte(toAnyFloat64(t["sv_ctrl"])),
				byte(toAnyFloat64(t["level_t1_field"])),
				byte(toAnyFloat64(t["level_t2_field"])),
				byte(toAnyFloat64(t["start_delta_pct"])),
				byte(toAnyFloat64(t["stop_t1_min_pct"])),
				byte(toAnyFloat64(t["measure_pulse_sec"])),
			}
			if err := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, payload); err != nil {
				return fmt.Errorf("pushAirConfig transfer: %w", err)
			}
		}
	}

	// 5. LoRaWAN: [0x06, region, subband, dr, txpwr, adr, confirmed]
	if len(effective.LoRaWAN) > 0 {
		var lora map[string]any
		if err := json.Unmarshal(effective.LoRaWAN, &lora); err == nil {
			adrByte := byte(0)
			if adr, ok := lora["adr"].(bool); ok && adr {
				adrByte = 1
			}
			confirmedByte := byte(0)
			if confirmed, ok := lora["confirmed"].(bool); ok && confirmed {
				confirmedByte = 1
			}
			payload := []byte{
				0x06,
				byte(toAnyFloat64(lora["region"])),
				byte(toAnyFloat64(lora["sub_band"])),
				byte(toAnyFloat64(lora["data_rate"])),
				byte(toAnyFloat64(lora["tx_power"])),
				adrByte,
				confirmedByte,
			}
			if err := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, payload); err != nil {
				return fmt.Errorf("pushAirConfig lorawan: %w", err)
			}
		}
	}

	// 6. SetHash: commits the expected config hash to the device so it can report it in checkin.
	// The device stores this and sends it in fPort 1 so the backend detects drift.
	hashStr := computeConfigHash(effective)
	hashVal, err := strconv.ParseUint(hashStr, 16, 32)
	if err == nil {
		hashPayload := make([]byte, 5)
		hashPayload[0] = 0x09
		binary.LittleEndian.PutUint32(hashPayload[1:], uint32(hashVal))
		if pushErr := EnqueueDownlinkForDevice(app, cfg, devEUI, 35, hashPayload); pushErr != nil {
			log.Printf("[airconfig] set_hash enqueue error dev_eui=%s: %v", devEUI, pushErr)
		}
	}

	log.Printf("[airconfig] queued push for dev_eui=%s", devEUI)
	return nil
}

// toAnyFloat64 extracts a float64 from an any value (JSON numbers decode as float64).
func toAnyFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}
