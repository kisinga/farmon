package main

import (
	"encoding/binary"
	"fmt"
	"log"
	"time"

	"github.com/kisinga/farmon/pi/internal/gateway"
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
// compares config_hash, and queues AirConfig push on mismatch.
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

	profileID := dev.GetString("profile")
	if profileID == "" {
		dev.Set("config_status", "n/a")
		return app.Save(dev)
	}

	// Load profile and compare config hash
	profile, err := loadProfileWithComponents(app, profileID)
	if err != nil {
		log.Printf("[checkin] load profile error: %v", err)
		return app.Save(dev)
	}

	if profile.ProfileType != "airconfig" || profile.AirConfig == nil {
		dev.Set("config_status", "n/a")
		return app.Save(dev)
	}

	// Get effective config (profile + device overrides)
	overridesJSON := dev.GetString("config_overrides")
	effective, err := getEffectiveAirConfig(profile, overridesJSON)
	if err != nil {
		dev.Set("config_status", "n/a")
		return app.Save(dev)
	}

	expectedHash := computeConfigHash(effective)
	if deviceHash == expectedHash {
		dev.Set("config_hash", deviceHash)
		dev.Set("config_status", "synced")
		log.Printf("[checkin] dev_eui=%s config synced (hash=%s)", devEUI, deviceHash)
	} else {
		dev.Set("config_status", "pending")
		log.Printf("[checkin] dev_eui=%s config mismatch: device=%s expected=%s — queuing push", devEUI, deviceHash, expectedHash)
		// Queue AirConfig push (non-blocking)
		if cfg != nil {
			go func() {
				if pushErr := pushAirConfig(app, cfg, devEUI, effective); pushErr != nil {
					log.Printf("[checkin] pushAirConfig error dev_eui=%s: %v", devEUI, pushErr)
				}
			}()
		}
	}

	return app.Save(dev)
}

// pushAirConfig builds and enqueues AirConfig frames for a device.
// This is a placeholder — full implementation in airconfig_push.go (Step 5).
func pushAirConfig(app core.App, cfg *gateway.Config, devEUI string, effective *ProfileAirConfig) error {
	log.Printf("[airconfig] push queued for dev_eui=%s hash=%s", devEUI, computeConfigHash(effective))
	// TODO: Step 5 — build AirConfig frames from effective config and enqueue via DownlinkQueue
	return nil
}
