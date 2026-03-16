package main

import (
	"hash/crc32"
	"encoding/json"
	"fmt"
	"log"
	"sort"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ProfileField mirrors a profile_fields record for in-memory use.
type ProfileField struct {
	ID          string  `json:"id,omitempty"`
	Key         string  `json:"key"`
	DisplayName string  `json:"display_name"`
	Unit        string  `json:"unit,omitempty"`
	DataType    string  `json:"data_type,omitempty"`
	Category    string  `json:"category,omitempty"`
	Access      string  `json:"access,omitempty"`
	StateClass  string  `json:"state_class,omitempty"`
	MinValue    float64 `json:"min_value,omitempty"`
	MaxValue    float64 `json:"max_value,omitempty"`
	SortOrder   int     `json:"sort_order"`
}

// ProfileControl mirrors a profile_controls record.
type ProfileControl struct {
	ID          string   `json:"id,omitempty"`
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name"`
	States      []string `json:"states"`
	SortOrder   int      `json:"sort_order"`
}

// ProfileCommand mirrors a profile_commands record.
type ProfileCommand struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name"`
	FPort       int    `json:"fport"`
	PayloadType string `json:"payload_type,omitempty"`
}

// DecodeRule mirrors a decode_rules record.
type DecodeRule struct {
	ID     string         `json:"id,omitempty"`
	FPort  int            `json:"fport"`
	Format string         `json:"format"`
	Config map[string]any `json:"config"`
}

// ProfileAirConfig mirrors a profile_airconfig record.
type ProfileAirConfig struct {
	ID         string         `json:"id,omitempty"`
	PinMap     json.RawMessage `json:"pin_map"`
	Sensors    json.RawMessage `json:"sensors"`
	Controls   json.RawMessage `json:"controls"`
	LoRaWAN    json.RawMessage `json:"lorawan"`
	ConfigHash string         `json:"config_hash,omitempty"`
}

// ProfileVisualization mirrors a profile_visualizations record.
type ProfileVisualization struct {
	ID        string         `json:"id,omitempty"`
	Name      string         `json:"name"`
	VizType   string         `json:"viz_type"`
	Config    map[string]any `json:"config"`
	SortOrder int            `json:"sort_order"`
}

// ProfileWithComponents is a profile plus all its sub-component records.
type ProfileWithComponents struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name"`
	Description    string                 `json:"description,omitempty"`
	ProfileType    string                 `json:"profile_type"`
	IsTemplate     bool                   `json:"is_template"`
	Fields         []ProfileField         `json:"fields"`
	Controls       []ProfileControl       `json:"controls"`
	Commands       []ProfileCommand       `json:"commands"`
	DecodeRules    []DecodeRule           `json:"decode_rules"`
	AirConfig      *ProfileAirConfig      `json:"airconfig,omitempty"`
	Visualizations []ProfileVisualization  `json:"visualizations"`
}

// loadProfileWithComponents loads a profile and all its sub-component records.
func loadProfileWithComponents(app core.App, profileID string) (*ProfileWithComponents, error) {
	rec, err := app.FindRecordById("device_profiles", profileID)
	if err != nil {
		return nil, fmt.Errorf("profile not found: %w", err)
	}
	p := &ProfileWithComponents{
		ID:          rec.Id,
		Name:        rec.GetString("name"),
		Description: rec.GetString("description"),
		ProfileType: rec.GetString("profile_type"),
		IsTemplate:  rec.GetBool("is_template"),
	}

	// Fields
	if fields, err := app.FindRecordsByFilter("profile_fields", "profile = {:pid}", "sort_order", 0, 0, dbx.Params{"pid": profileID}); err == nil {
		for _, r := range fields {
			p.Fields = append(p.Fields, ProfileField{
				ID:          r.Id,
				Key:         r.GetString("key"),
				DisplayName: r.GetString("display_name"),
				Unit:        r.GetString("unit"),
				DataType:    r.GetString("data_type"),
				Category:    r.GetString("category"),
				Access:      r.GetString("access"),
				StateClass:  r.GetString("state_class"),
				MinValue:    getRecordFloat(r, "min_value"),
				MaxValue:    getRecordFloat(r, "max_value"),
				SortOrder:   getRecordInt(r, "sort_order"),
			})
		}
	}

	// Controls
	if controls, err := app.FindRecordsByFilter("profile_controls", "profile = {:pid}", "sort_order", 0, 0, dbx.Params{"pid": profileID}); err == nil {
		for _, r := range controls {
			var states []string
			statesRaw := r.Get("states")
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
			p.Controls = append(p.Controls, ProfileControl{
				ID:          r.Id,
				Key:         r.GetString("key"),
				DisplayName: r.GetString("display_name"),
				States:      states,
				SortOrder:   getRecordInt(r, "sort_order"),
			})
		}
	}

	// Commands
	if cmds, err := app.FindRecordsByFilter("profile_commands", "profile = {:pid}", "name", 0, 0, dbx.Params{"pid": profileID}); err == nil {
		for _, r := range cmds {
			p.Commands = append(p.Commands, ProfileCommand{
				ID:          r.Id,
				Name:        r.GetString("name"),
				FPort:       getRecordInt(r, "fport"),
				PayloadType: r.GetString("payload_type"),
			})
		}
	}

	// Decode rules
	if rules, err := app.FindRecordsByFilter("decode_rules", "profile = {:pid}", "fport", 0, 0, dbx.Params{"pid": profileID}); err == nil {
		for _, r := range rules {
			var cfg map[string]any
			cfgRaw := r.Get("config")
			switch v := cfgRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &cfg)
			case map[string]any:
				cfg = v
			}
			p.DecodeRules = append(p.DecodeRules, DecodeRule{
				ID:     r.Id,
				FPort:  getRecordInt(r, "fport"),
				Format: r.GetString("format"),
				Config: cfg,
			})
		}
	}

	// AirConfig (0 or 1 record)
	if ac, err := app.FindFirstRecordByFilter("profile_airconfig", "profile = {:pid}", dbx.Params{"pid": profileID}); err == nil {
		p.AirConfig = &ProfileAirConfig{
			ID:         ac.Id,
			PinMap:     getRawJSON(ac, "pin_map"),
			Sensors:    getRawJSON(ac, "sensors"),
			Controls:   getRawJSON(ac, "controls"),
			LoRaWAN:    getRawJSON(ac, "lorawan"),
			ConfigHash: ac.GetString("config_hash"),
		}
	}

	// Visualizations
	if vizs, err := app.FindRecordsByFilter("profile_visualizations", "profile = {:pid}", "sort_order", 0, 0, dbx.Params{"pid": profileID}); err == nil {
		for _, r := range vizs {
			var cfg map[string]any
			cfgRaw := r.Get("config")
			switch v := cfgRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &cfg)
			case map[string]any:
				cfg = v
			}
			p.Visualizations = append(p.Visualizations, ProfileVisualization{
				ID:        r.Id,
				Name:      r.GetString("name"),
				VizType:   r.GetString("viz_type"),
				Config:    cfg,
				SortOrder: getRecordInt(r, "sort_order"),
			})
		}
	}

	return p, nil
}

// loadProfileForDevice loads the profile associated with a device.
func loadProfileForDevice(app core.App, devEUI string) (*ProfileWithComponents, error) {
	dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return nil, fmt.Errorf("device not found: %s", devEUI)
	}
	profileID := dev.GetString("profile")
	if profileID == "" {
		return nil, fmt.Errorf("device %s has no profile assigned", devEUI)
	}
	return loadProfileWithComponents(app, profileID)
}

// getDecodeRuleForFPort returns the decode rule for a given fPort from a loaded profile.
func getDecodeRuleForFPort(profile *ProfileWithComponents, fPort int) *DecodeRule {
	for i := range profile.DecodeRules {
		if profile.DecodeRules[i].FPort == fPort {
			return &profile.DecodeRules[i]
		}
	}
	return nil
}

// getCommandFPort returns the fPort for a named command from a loaded profile.
func getCommandFPort(profile *ProfileWithComponents, cmdName string) (int, error) {
	for _, cmd := range profile.Commands {
		if cmd.Name == cmdName {
			return cmd.FPort, nil
		}
	}
	return 0, fmt.Errorf("command %q not found in profile %s", cmdName, profile.Name)
}

// getControlByIndex returns the profile control at a given sort_order index.
func getControlByIndex(profile *ProfileWithComponents, idx int) *ProfileControl {
	for i := range profile.Controls {
		if profile.Controls[i].SortOrder == idx {
			return &profile.Controls[i]
		}
	}
	return nil
}

// getFieldByIndex returns the profile field at a given sort_order index.
func getFieldByIndex(profile *ProfileWithComponents, idx int) *ProfileField {
	for i := range profile.Fields {
		if profile.Fields[i].SortOrder == idx {
			return &profile.Fields[i]
		}
	}
	return nil
}

// resolveStateNameFromProfile resolves a state index to a name using the profile control's states array.
func resolveStateNameFromProfile(ctrl *ProfileControl, stateIdx int) string {
	if ctrl != nil && stateIdx >= 0 && stateIdx < len(ctrl.States) {
		return ctrl.States[stateIdx]
	}
	if stateIdx == 0 {
		return "off"
	}
	return "on"
}

// materializeProfileToDevice copies profile_fields→device_fields and profile_controls→device_controls for a device.
func materializeProfileToDevice(app core.App, devEUI string, profile *ProfileWithComponents) error {
	// Materialize fields
	fieldColl, err := app.FindCollectionByNameOrId("device_fields")
	if err != nil {
		return err
	}
	for _, f := range profile.Fields {
		existing, findErr := app.FindFirstRecordByFilter("device_fields",
			"device_eui = {:eui} && field_key = {:key}",
			dbx.Params{"eui": devEUI, "key": f.Key})
		rec := existing
		if findErr != nil {
			rec = core.NewRecord(fieldColl)
			rec.Set("device_eui", devEUI)
			rec.Set("field_key", f.Key)
		}
		rec.Set("display_name", f.DisplayName)
		rec.Set("data_type", orDefault(f.DataType, "number"))
		rec.Set("unit", f.Unit)
		rec.Set("category", orDefault(f.Category, "telemetry"))
		rec.Set("access", orDefault(f.Access, "r"))
		rec.Set("state_class", f.StateClass)
		rec.Set("field_idx", f.SortOrder)
		rec.Set("min_value", f.MinValue)
		rec.Set("max_value", f.MaxValue)
		if err := app.Save(rec); err != nil {
			log.Printf("[profiles] materialize field %s for %s: %v", f.Key, devEUI, err)
		}
	}

	// Materialize controls
	ctrlColl, err := app.FindCollectionByNameOrId("device_controls")
	if err != nil {
		return err
	}
	for _, c := range profile.Controls {
		existing, findErr := app.FindFirstRecordByFilter("device_controls",
			"device_eui = {:eui} && control_key = {:key}",
			dbx.Params{"eui": devEUI, "key": c.Key})
		statesJSON, _ := json.Marshal(c.States)
		rec := existing
		if findErr != nil {
			rec = core.NewRecord(ctrlColl)
			rec.Set("device_eui", devEUI)
			rec.Set("control_key", c.Key)
			initialState := "off"
			if len(c.States) > 0 {
				initialState = c.States[0]
			}
			rec.Set("current_state", initialState)
		}
		rec.Set("display_name", c.DisplayName)
		rec.Set("states_json", string(statesJSON))
		rec.Set("control_idx", c.SortOrder)
		if err := app.Save(rec); err != nil {
			log.Printf("[profiles] materialize control %s for %s: %v", c.Key, devEUI, err)
		}
	}

	return nil
}

// computeConfigHash computes a CRC32 hex hash of the airconfig JSON components.
func computeConfigHash(ac *ProfileAirConfig) string {
	if ac == nil {
		return ""
	}
	h := crc32.NewIEEE()
	h.Write(ac.PinMap)
	h.Write(ac.Sensors)
	h.Write(ac.Controls)
	h.Write(ac.LoRaWAN)
	return fmt.Sprintf("%08x", h.Sum32())
}

// getEffectiveAirConfig merges profile airconfig with per-device config_overrides.
func getEffectiveAirConfig(profile *ProfileWithComponents, overridesJSON string) (*ProfileAirConfig, error) {
	if profile.AirConfig == nil {
		return nil, fmt.Errorf("profile %s has no airconfig", profile.Name)
	}
	if overridesJSON == "" || overridesJSON == "null" {
		return profile.AirConfig, nil
	}

	// Parse overrides
	var overrides map[string]json.RawMessage
	if err := json.Unmarshal([]byte(overridesJSON), &overrides); err != nil {
		return profile.AirConfig, nil // ignore invalid overrides
	}

	effective := &ProfileAirConfig{
		PinMap:   profile.AirConfig.PinMap,
		Sensors:  profile.AirConfig.Sensors,
		Controls: profile.AirConfig.Controls,
		LoRaWAN:  profile.AirConfig.LoRaWAN,
	}

	if v, ok := overrides["pin_map"]; ok {
		effective.PinMap = v
	}
	if v, ok := overrides["sensors"]; ok {
		effective.Sensors = v
	}
	if v, ok := overrides["controls"]; ok {
		effective.Controls = v
	}
	if v, ok := overrides["lorawan"]; ok {
		// Merge lorawan fields instead of full replace
		var base map[string]any
		var over map[string]any
		if json.Unmarshal(profile.AirConfig.LoRaWAN, &base) == nil && json.Unmarshal(v, &over) == nil {
			for k, val := range over {
				base[k] = val
			}
			merged, _ := json.Marshal(base)
			effective.LoRaWAN = merged
		} else {
			effective.LoRaWAN = v
		}
	}

	effective.ConfigHash = computeConfigHash(effective)
	return effective, nil
}

// seedDefaultProfiles seeds the FarMon Water Monitor and SenseCAP S2105 profiles if they don't exist.
func seedDefaultProfiles(app core.App) {
	// Check if profiles already exist
	if _, err := app.FindFirstRecordByFilter("device_profiles", "name = {:name}", dbx.Params{"name": "FarMon Water Monitor v1"}); err == nil {
		return // already seeded
	}

	log.Println("[profiles] seeding default profiles...")

	// Seed FarMon Water Monitor v1
	seedFarMonWaterMonitor(app)

	// Seed SenseCAP S2105
	seedSenseCapS2105(app)
}

func seedFarMonWaterMonitor(app core.App) {
	profileID := createProfile(app, "FarMon Water Monitor v1", "LoRa-E5 based water flow monitor with pump/valve control", "airconfig", true)
	if profileID == "" {
		return
	}

	// Fields
	fieldsData := []ProfileField{
		{Key: "pd", DisplayName: "Pulse Delta", Unit: "", Category: "telemetry", Access: "r", StateClass: "d", MaxValue: 65535, SortOrder: 0},
		{Key: "tv", DisplayName: "Total Volume", Unit: "L", Category: "telemetry", Access: "r", StateClass: "i", MaxValue: 999999, SortOrder: 1},
		{Key: "bp", DisplayName: "Battery", Unit: "%", Category: "system", Access: "r", StateClass: "m", MaxValue: 100, SortOrder: 2},
		{Key: "tx", DisplayName: "TX Interval", Unit: "s", Category: "system", Access: "w", StateClass: "m", MaxValue: 3600, SortOrder: 3},
	}
	for _, f := range fieldsData {
		createProfileField(app, profileID, f)
	}

	// Controls
	controlsData := []ProfileControl{
		{Key: "pump", DisplayName: "Water Pump", States: []string{"off", "on"}, SortOrder: 0},
		{Key: "valve", DisplayName: "Valve", States: []string{"closed", "open"}, SortOrder: 1},
	}
	for _, c := range controlsData {
		createProfileControl(app, profileID, c)
	}

	// Commands
	commandsData := []ProfileCommand{
		{Name: "reset", FPort: 10, PayloadType: "empty"},
		{Name: "interval", FPort: 11, PayloadType: "uint16_le_seconds"},
		{Name: "reboot", FPort: 12, PayloadType: "empty"},
		{Name: "clearerr", FPort: 13, PayloadType: "empty"},
		{Name: "forcereg", FPort: 14, PayloadType: "empty"},
		{Name: "status", FPort: 15, PayloadType: "empty"},
		{Name: "ctrl", FPort: 20, PayloadType: "control_binary"},
		{Name: "rule", FPort: 30, PayloadType: "rule_binary"},
	}
	for _, cmd := range commandsData {
		createProfileCommand(app, profileID, cmd)
	}

	// Decode rules
	createDecodeRule(app, profileID, 2, "text_kv", map[string]any{
		"separator": ",", "kv_separator": ":",
	})
	createDecodeRule(app, profileID, 3, "binary_state_change", map[string]any{
		"record_size": 11,
		"layout": []map[string]any{
			{"offset": 0, "name": "control_idx", "type": "uint8"},
			{"offset": 1, "name": "new_state", "type": "uint8"},
			{"offset": 2, "name": "old_state", "type": "uint8"},
			{"offset": 3, "name": "source_id", "type": "uint8"},
			{"offset": 4, "name": "rule_id", "type": "uint8"},
			{"offset": 5, "name": "device_ms", "type": "uint32_le"},
			{"offset": 9, "name": "seq", "type": "uint16_le"},
		},
		"source_map": map[string]string{"0": "BOOT", "1": "RULE", "2": "MANUAL", "3": "DOWNLINK"},
	})
	createDecodeRule(app, profileID, 4, "text_kv", map[string]any{
		"separator": ":", "kv_separator": ":",
	})

	// AirConfig
	createProfileAirConfig(app, profileID,
		`[0,0,0,0,7,0,0,0,9,9,0,0,0,0,0,0,0,0,0,0]`,
		`[{"type":1,"pin_index":4,"field_index":0,"flags":1,"param1":450}]`,
		`[{"pin_index":8,"state_count":2,"flags":1},{"pin_index":9,"state_count":2,"flags":1}]`,
		`{"region":0,"sub_band":1,"data_rate":0,"tx_power":0,"adr":true,"confirmed":false}`,
	)

	// Visualizations
	createProfileVisualization(app, profileID, "Water Flow", "time_series", map[string]any{
		"fields": []string{"pd"}, "y_label": "Pulses", "y_unit": "",
	}, 0)
	createProfileVisualization(app, profileID, "Total Volume", "time_series", map[string]any{
		"fields": []string{"tv"}, "y_label": "Volume", "y_unit": "L",
	}, 1)
	createProfileVisualization(app, profileID, "Battery", "gauge", map[string]any{
		"field": "bp",
		"color_ranges": []map[string]any{
			{"max": 20, "color": "error"},
			{"max": 50, "color": "warning"},
			{"max": 100, "color": "success"},
		},
	}, 2)
	createProfileVisualization(app, profileID, "TX Interval", "stat", map[string]any{
		"field": "tx", "suffix": "s",
	}, 3)

	log.Printf("[profiles] seeded FarMon Water Monitor v1 (id=%s)", profileID)
}

func seedSenseCapS2105(app core.App) {
	profileID := createProfile(app, "SenseCAP S2105", "Seeed SenseCAP S2105 soil moisture & temperature sensor", "codec", true)
	if profileID == "" {
		return
	}

	// Fields
	createProfileField(app, profileID, ProfileField{Key: "soil_moisture", DisplayName: "Soil Moisture", Unit: "%", Category: "telemetry", StateClass: "m", MaxValue: 100, SortOrder: 0})
	createProfileField(app, profileID, ProfileField{Key: "soil_temperature", DisplayName: "Soil Temperature", Unit: "°C", Category: "telemetry", StateClass: "m", MaxValue: 80, SortOrder: 1})

	// Decode rule
	createDecodeRule(app, profileID, 2, "binary_frames", map[string]any{
		"frame_size": 7,
		"layout": []map[string]any{
			{"offset": 0, "size": 1, "name": "_channel", "type": "uint8"},
			{"offset": 1, "size": 2, "name": "_type_id", "type": "uint16_le"},
			{"offset": 3, "size": 4, "name": "_raw_value", "type": "int32_le"},
		},
		"dispatch_key": "_type_id",
		"value_key":    "_raw_value",
		"mappings": map[string]any{
			"1794": map[string]any{"key": "soil_moisture", "transform": "value / 1000"},
			"1795": map[string]any{"key": "soil_temperature", "transform": "value / 1000"},
		},
	})

	// Visualizations
	createProfileVisualization(app, profileID, "Soil Conditions", "time_series", map[string]any{
		"fields": []string{"soil_moisture", "soil_temperature"}, "y_label": "Value", "y_unit": "",
	}, 0)
	createProfileVisualization(app, profileID, "Soil Moisture", "gauge", map[string]any{
		"field": "soil_moisture",
		"color_ranges": []map[string]any{
			{"max": 20, "color": "error"},
			{"max": 40, "color": "warning"},
			{"max": 100, "color": "success"},
		},
	}, 1)

	log.Printf("[profiles] seeded SenseCAP S2105 (id=%s)", profileID)
}

// --- Seed helpers ---

func createProfile(app core.App, name, description, profileType string, isTemplate bool) string {
	coll, err := app.FindCollectionByNameOrId("device_profiles")
	if err != nil {
		log.Printf("[profiles] seed: collection not found: %v", err)
		return ""
	}
	rec := core.NewRecord(coll)
	rec.Set("name", name)
	rec.Set("description", description)
	rec.Set("profile_type", profileType)
	rec.Set("is_template", isTemplate)
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed create %s: %v", name, err)
		return ""
	}
	return rec.Id
}

func createProfileField(app core.App, profileID string, f ProfileField) {
	coll, err := app.FindCollectionByNameOrId("profile_fields")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("key", f.Key)
	rec.Set("display_name", f.DisplayName)
	rec.Set("unit", f.Unit)
	rec.Set("data_type", orDefault(f.DataType, "number"))
	rec.Set("category", orDefault(f.Category, "telemetry"))
	rec.Set("access", orDefault(f.Access, "r"))
	rec.Set("state_class", f.StateClass)
	rec.Set("min_value", f.MinValue)
	rec.Set("max_value", f.MaxValue)
	rec.Set("sort_order", f.SortOrder)
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed field %s: %v", f.Key, err)
	}
}

func createProfileControl(app core.App, profileID string, c ProfileControl) {
	coll, err := app.FindCollectionByNameOrId("profile_controls")
	if err != nil {
		return
	}
	statesJSON, _ := json.Marshal(c.States)
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("key", c.Key)
	rec.Set("display_name", c.DisplayName)
	rec.Set("states", string(statesJSON))
	rec.Set("sort_order", c.SortOrder)
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed control %s: %v", c.Key, err)
	}
}

func createProfileCommand(app core.App, profileID string, cmd ProfileCommand) {
	coll, err := app.FindCollectionByNameOrId("profile_commands")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("name", cmd.Name)
	rec.Set("fport", cmd.FPort)
	rec.Set("payload_type", orDefault(cmd.PayloadType, "empty"))
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed command %s: %v", cmd.Name, err)
	}
}

func createDecodeRule(app core.App, profileID string, fport int, format string, config map[string]any) {
	coll, err := app.FindCollectionByNameOrId("decode_rules")
	if err != nil {
		return
	}
	cfgJSON, _ := json.Marshal(config)
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("fport", fport)
	rec.Set("format", format)
	rec.Set("config", string(cfgJSON))
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed decode rule fport=%d: %v", fport, err)
	}
}

func createProfileAirConfig(app core.App, profileID, pinMap, sensors, controls, lorawan string) {
	coll, err := app.FindCollectionByNameOrId("profile_airconfig")
	if err != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("pin_map", pinMap)
	rec.Set("sensors", sensors)
	rec.Set("controls", controls)
	rec.Set("lorawan", lorawan)

	// Compute config hash
	ac := &ProfileAirConfig{
		PinMap:   json.RawMessage(pinMap),
		Sensors:  json.RawMessage(sensors),
		Controls: json.RawMessage(controls),
		LoRaWAN:  json.RawMessage(lorawan),
	}
	rec.Set("config_hash", computeConfigHash(ac))

	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed airconfig: %v", err)
	}
}

func createProfileVisualization(app core.App, profileID, name, vizType string, config map[string]any, sortOrder int) {
	coll, err := app.FindCollectionByNameOrId("profile_visualizations")
	if err != nil {
		return
	}
	cfgJSON, _ := json.Marshal(config)
	rec := core.NewRecord(coll)
	rec.Set("profile", profileID)
	rec.Set("name", name)
	rec.Set("viz_type", vizType)
	rec.Set("config", string(cfgJSON))
	rec.Set("sort_order", sortOrder)
	if err := app.Save(rec); err != nil {
		log.Printf("[profiles] seed visualization %s: %v", name, err)
	}
}

// --- Utility helpers ---

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func getRecordFloat(r *core.Record, key string) float64 {
	v := r.Get(key)
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

func getRecordInt(r *core.Record, key string) int {
	v := r.Get(key)
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func getRawJSON(r *core.Record, key string) json.RawMessage {
	v := r.Get(key)
	switch val := v.(type) {
	case string:
		return json.RawMessage(val)
	default:
		b, _ := json.Marshal(val)
		return b
	}
}

// sortedFieldKeys returns field keys sorted by sort_order for a profile.
func sortedFieldKeys(fields []ProfileField) []string {
	sorted := make([]ProfileField, len(fields))
	copy(sorted, fields)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].SortOrder < sorted[j].SortOrder })
	keys := make([]string, len(sorted))
	for i, f := range sorted {
		keys[i] = f.Key
	}
	return keys
}
