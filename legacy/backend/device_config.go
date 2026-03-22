package main

import (
	"encoding/json"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// FieldMapping is a minimal field index → key mapping used by the decode engine.
type FieldMapping struct {
	Index int
	Key   string
}

// DeviceControlInfo holds control metadata loaded from device_controls for runtime resolution.
type DeviceControlInfo struct {
	ControlKey string
	States     []string
	ControlIdx int
}

// DeviceConfig holds all device-level configuration loaded from device collections.
// This replaces loading a profile at runtime.
type DeviceConfig struct {
	DeviceType  string
	Fields      []FieldMapping
	Controls    []DeviceControlInfo
	DecodeRules []DecodeRule
	AirConfig   *AirConfig
}

// loadDeviceConfig loads all device-level configuration from device collections.
// This is the device-level replacement for loadProfileForDevice.
func loadDeviceConfig(app core.App, devEUI string) (*DeviceConfig, error) {
	dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return nil, fmt.Errorf("device not found: %s", devEUI)
	}

	cfg := &DeviceConfig{
		DeviceType: dev.GetString("device_type"),
	}

	// Load fields
	if fields, err := app.FindRecordsByFilter("device_fields",
		"device_eui = {:eui}", "field_idx", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, f := range fields {
			cfg.Fields = append(cfg.Fields, FieldMapping{
				Index: getRecordInt(f, "field_idx"),
				Key:   f.GetString("field_key"),
			})
		}
	}

	// Load controls
	if controls, err := app.FindRecordsByFilter("device_controls",
		"device_eui = {:eui}", "control_idx", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, c := range controls {
			var states []string
			statesRaw := c.Get("states_json")
			switch v := statesRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &states)
			case []any:
				for _, s := range v {
					if str, ok := s.(string); ok {
						states = append(states, str)
					}
				}
			}
			cfg.Controls = append(cfg.Controls, DeviceControlInfo{
				ControlKey: c.GetString("control_key"),
				States:     states,
				ControlIdx: getRecordInt(c, "control_idx"),
			})
		}
	}

	// Load decode rules
	if rules, err := app.FindRecordsByFilter("device_decode_rules",
		"device_eui = {:eui}", "fport", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range rules {
			var cfg2 map[string]any
			cfgRaw := r.Get("config")
			switch v := cfgRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &cfg2)
			case map[string]any:
				cfg2 = v
			}
			cfg.DecodeRules = append(cfg.DecodeRules, DecodeRule{
				FPort:  getRecordInt(r, "fport"),
				Format: r.GetString("format"),
				Config: cfg2,
			})
		}
	}

	// Load airconfig
	if ac, err := app.FindFirstRecordByFilter("device_airconfig",
		"device_eui = {:eui}", dbx.Params{"eui": devEUI}); err == nil {
		cfg.AirConfig = &AirConfig{
			PinMap:     getRawJSON(ac, "pin_map"),
			Sensors:    getRawJSON(ac, "sensors"),
			Controls:   getRawJSON(ac, "controls"),
			LoRaWAN:    getRawJSON(ac, "lorawan"),
			Transfer:   getRawJSON(ac, "transfer"),
			ConfigHash: ac.GetString("config_hash"),
		}
	}

	return cfg, nil
}

// loadDeviceAirConfig loads just the device airconfig for hash comparison and push.
func loadDeviceAirConfig(app core.App, devEUI string) (*AirConfig, error) {
	ac, err := app.FindFirstRecordByFilter("device_airconfig",
		"device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return nil, fmt.Errorf("no airconfig for device %s", devEUI)
	}
	return &AirConfig{
		PinMap:     getRawJSON(ac, "pin_map"),
		Sensors:    getRawJSON(ac, "sensors"),
		Controls:   getRawJSON(ac, "controls"),
		LoRaWAN:    getRawJSON(ac, "lorawan"),
		Transfer:   getRawJSON(ac, "transfer"),
		ConfigHash: ac.GetString("config_hash"),
	}, nil
}

// upsertAirConfigSlot finds or creates the device_airconfig record and updates
// a single slot in the given JSON array field ("sensors" or "controls").
func upsertAirConfigSlot(app core.App, devEUI, field string, slot int, data map[string]any) error {
	acColl, err := app.FindCollectionByNameOrId("device_airconfig")
	if err != nil {
		return fmt.Errorf("device_airconfig collection not found")
	}

	rec, err := app.FindFirstRecordByFilter("device_airconfig",
		"device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		// Create stub record
		rec = core.NewRecord(acColl)
		rec.Set("device_eui", devEUI)
		rec.Set("pin_map", []any{})
		rec.Set("sensors", []any{})
		rec.Set("controls", []any{})
		rec.Set("lorawan", map[string]any{})
	}

	// Read existing array
	var arr []any
	raw := rec.Get(field)
	switch v := raw.(type) {
	case string:
		_ = json.Unmarshal([]byte(v), &arr)
	case []any:
		arr = v
	}

	// Extend array if needed
	for len(arr) <= slot {
		arr = append(arr, map[string]any{})
	}
	arr[slot] = data
	rec.Set(field, arr)

	return app.Save(rec)
}

// getDeviceControlByIndex returns the device control at a given control_idx.
func getDeviceControlByIndex(cfg *DeviceConfig, idx int) *DeviceControlInfo {
	for i := range cfg.Controls {
		if cfg.Controls[i].ControlIdx == idx {
			return &cfg.Controls[i]
		}
	}
	return nil
}

// resolveStateNameFromDevice resolves a state index to a name using device control states.
func resolveStateNameFromDevice(ctrl *DeviceControlInfo, stateIdx int) string {
	if ctrl != nil && stateIdx >= 0 && stateIdx < len(ctrl.States) {
		return ctrl.States[stateIdx]
	}
	if stateIdx == 0 {
		return "off"
	}
	return "on"
}

// getDeviceDecodeRuleForFPort returns the decode rule for a given fPort from device config.
func getDeviceDecodeRuleForFPort(cfg *DeviceConfig, fPort int) *DecodeRule {
	for i := range cfg.DecodeRules {
		if cfg.DecodeRules[i].FPort == fPort {
			return &cfg.DecodeRules[i]
		}
	}
	return nil
}
