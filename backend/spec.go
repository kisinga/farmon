package main

import (
	"encoding/json"
	"fmt"
	"hash/crc32"
	"log"
	"sort"

	"github.com/farmon/firmware/pkg/catalog"
	"github.com/farmon/firmware/pkg/settings"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ── Spec types ──────────────────────────────────────────────────────────────
// These define the JSON document shape for device specs (templates).
// No ID fields — specs are value objects, not DB entities.

// SpecField defines a telemetry or system field.
type SpecField struct {
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

// SpecControl defines an actuator/switch.
type SpecControl struct {
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name"`
	States      []string `json:"states"`
	SortOrder   int      `json:"sort_order"`
}

// SpecCommand defines a remote command.
type SpecCommand struct {
	Name        string `json:"name"`
	FPort       int    `json:"fport"`
	PayloadType string `json:"payload_type,omitempty"`
	Delivery    string `json:"delivery,omitempty"`
	CommandKey  string `json:"command_key,omitempty"`
}

// DecodeRule defines how to parse incoming data on a given fPort.
type DecodeRule struct {
	FPort  int            `json:"fport"`
	Format string         `json:"format"`
	Config map[string]any `json:"config"`
}

// AirConfig holds hardware configuration (pin maps, sensors, controls, LoRaWAN settings).
type AirConfig struct {
	PinMap     json.RawMessage `json:"pin_map"`
	Sensors    json.RawMessage `json:"sensors"`
	Controls   json.RawMessage `json:"controls"`
	LoRaWAN    json.RawMessage `json:"lorawan"`
	Transfer   json.RawMessage `json:"transfer,omitempty"`
	ConfigHash string          `json:"config_hash,omitempty"`
}

// SpecVisualization defines how to display a field.
type SpecVisualization struct {
	Name      string         `json:"name"`
	VizType   string         `json:"viz_type"`
	Config    map[string]any `json:"config"`
	SortOrder int            `json:"sort_order"`
}

// DeviceSpec is the full JSON document that defines a device's configuration.
// This is what users paste during provisioning or import via the advanced JSON modal.
type DeviceSpec struct {
	Type           string              `json:"type"` // "airconfig" | "codec"
	Fields         []SpecField         `json:"fields"`
	Controls       []SpecControl       `json:"controls"`
	Commands       []SpecCommand       `json:"commands"`
	DecodeRules    []DecodeRule        `json:"decode_rules"`
	AirConfig      *AirConfig          `json:"airconfig,omitempty"`
	Visualizations []SpecVisualization `json:"visualizations"`
}

// ── Spec → Device materialization ───────────────────────────────────────────

// materializeSpecToDevice stamps a full spec onto a device's runtime collections.
// It deletes all existing device-level records and creates fresh copies from the spec.
func materializeSpecToDevice(app core.App, devEUI string, spec *DeviceSpec) error {
	// Delete existing device-level records for clean stamp
	deleteDeviceRecords(app, devEUI, "device_fields", "device_eui")
	deleteDeviceRecords(app, devEUI, "device_controls", "device_eui")
	deleteDeviceRecords(app, devEUI, "device_airconfig", "device_eui")
	deleteDeviceRecords(app, devEUI, "device_decode_rules", "device_eui")
	deleteDeviceRecords(app, devEUI, "device_commands", "device_eui")
	deleteDeviceRecords(app, devEUI, "device_visualizations", "device_eui")

	// Materialize fields
	if fieldColl, err := app.FindCollectionByNameOrId("device_fields"); err == nil {
		for _, f := range spec.Fields {
			rec := core.NewRecord(fieldColl)
			rec.Set("device_eui", devEUI)
			rec.Set("field_key", f.Key)
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
				log.Printf("[materialize] field %s for %s: %v", f.Key, devEUI, err)
			}
		}
	}

	// Materialize controls
	if ctrlColl, err := app.FindCollectionByNameOrId("device_controls"); err == nil {
		for _, c := range spec.Controls {
			statesJSON, _ := json.Marshal(c.States)
			initialState := "off"
			if len(c.States) > 0 {
				initialState = c.States[0]
			}
			rec := core.NewRecord(ctrlColl)
			rec.Set("device_eui", devEUI)
			rec.Set("control_key", c.Key)
			rec.Set("display_name", c.DisplayName)
			rec.Set("states_json", string(statesJSON))
			rec.Set("control_idx", c.SortOrder)
			rec.Set("current_state", initialState)
			if err := app.Save(rec); err != nil {
				log.Printf("[materialize] control %s for %s: %v", c.Key, devEUI, err)
			}
		}
	}

	// Materialize airconfig
	if spec.AirConfig != nil {
		if acColl, err := app.FindCollectionByNameOrId("device_airconfig"); err == nil {
			rec := core.NewRecord(acColl)
			rec.Set("device_eui", devEUI)
			rec.Set("pin_map", spec.AirConfig.PinMap)
			rec.Set("sensors", spec.AirConfig.Sensors)
			rec.Set("controls", spec.AirConfig.Controls)
			rec.Set("lorawan", spec.AirConfig.LoRaWAN)
			rec.Set("transfer", spec.AirConfig.Transfer)
			rec.Set("config_hash", computeConfigHash(spec.AirConfig))
			if err := app.Save(rec); err != nil {
				log.Printf("[materialize] airconfig for %s: %v", devEUI, err)
			}
		}
	}

	// Materialize decode rules
	if drColl, err := app.FindCollectionByNameOrId("device_decode_rules"); err == nil {
		for _, rule := range spec.DecodeRules {
			cfgJSON, _ := json.Marshal(rule.Config)
			rec := core.NewRecord(drColl)
			rec.Set("device_eui", devEUI)
			rec.Set("fport", rule.FPort)
			rec.Set("format", rule.Format)
			rec.Set("config", string(cfgJSON))
			if err := app.Save(rec); err != nil {
				log.Printf("[materialize] decode rule fport=%d for %s: %v", rule.FPort, devEUI, err)
			}
		}
		// Add synthetic airconfig decode rules if not covered by explicit rules
		if spec.Type == "airconfig" {
			existingFPorts := make(map[int]bool)
			for _, r := range spec.DecodeRules {
				existingFPorts[r.FPort] = true
			}
			for fPort := 2; fPort <= 4; fPort++ {
				if existingFPorts[fPort] {
					continue
				}
				synth := airconfigSyntheticRule(fPort)
				if synth == nil {
					continue
				}
				cfgJSON, _ := json.Marshal(synth.Config)
				rec := core.NewRecord(drColl)
				rec.Set("device_eui", devEUI)
				rec.Set("fport", synth.FPort)
				rec.Set("format", synth.Format)
				rec.Set("config", string(cfgJSON))
				if err := app.Save(rec); err != nil {
					log.Printf("[materialize] synthetic decode rule fport=%d for %s: %v", fPort, devEUI, err)
				}
			}
		}
	}

	// Materialize commands
	if cmdColl, err := app.FindCollectionByNameOrId("device_commands"); err == nil {
		for _, cmd := range spec.Commands {
			rec := core.NewRecord(cmdColl)
			rec.Set("device_eui", devEUI)
			rec.Set("name", cmd.Name)
			rec.Set("fport", cmd.FPort)
			rec.Set("payload_type", orDefault(cmd.PayloadType, "empty"))
			rec.Set("delivery", cmd.Delivery)
			rec.Set("command_key", cmd.CommandKey)
			if err := app.Save(rec); err != nil {
				log.Printf("[materialize] command %s for %s: %v", cmd.Name, devEUI, err)
			}
		}
	}

	// Materialize visualizations
	if vizColl, err := app.FindCollectionByNameOrId("device_visualizations"); err == nil {
		for _, viz := range spec.Visualizations {
			cfgJSON, _ := json.Marshal(viz.Config)
			rec := core.NewRecord(vizColl)
			rec.Set("device_eui", devEUI)
			rec.Set("name", viz.Name)
			rec.Set("viz_type", viz.VizType)
			rec.Set("config", string(cfgJSON))
			rec.Set("sort_order", viz.SortOrder)
			if err := app.Save(rec); err != nil {
				log.Printf("[materialize] visualization %s for %s: %v", viz.Name, devEUI, err)
			}
		}
	}

	return nil
}

// ── Device → Spec composition (reverse of materialize) ─────────────────────

// loadDeviceSpec reads device-level collections and composes a DeviceSpec JSON document.
// This is the reverse of materializeSpecToDevice — used for the JSON export/view.
func loadDeviceSpec(app core.App, devEUI string) (*DeviceSpec, error) {
	dev, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return nil, fmt.Errorf("device not found: %s", devEUI)
	}

	spec := &DeviceSpec{
		Type: dev.GetString("device_type"),
	}

	// Fields
	if fields, err := app.FindRecordsByFilter("device_fields",
		"device_eui = {:eui}", "field_idx", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range fields {
			spec.Fields = append(spec.Fields, SpecField{
				Key:         r.GetString("field_key"),
				DisplayName: r.GetString("display_name"),
				Unit:        r.GetString("unit"),
				DataType:    r.GetString("data_type"),
				Category:    r.GetString("category"),
				Access:      r.GetString("access"),
				StateClass:  r.GetString("state_class"),
				MinValue:    getRecordFloat(r, "min_value"),
				MaxValue:    getRecordFloat(r, "max_value"),
				SortOrder:   getRecordInt(r, "field_idx"),
			})
		}
	}

	// Controls
	if controls, err := app.FindRecordsByFilter("device_controls",
		"device_eui = {:eui}", "control_idx", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range controls {
			var states []string
			statesRaw := r.Get("states_json")
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
			spec.Controls = append(spec.Controls, SpecControl{
				Key:         r.GetString("control_key"),
				DisplayName: r.GetString("display_name"),
				States:      states,
				SortOrder:   getRecordInt(r, "control_idx"),
			})
		}
	}

	// Commands
	if cmds, err := app.FindRecordsByFilter("device_commands",
		"device_eui = {:eui}", "name", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range cmds {
			spec.Commands = append(spec.Commands, SpecCommand{
				Name:        r.GetString("name"),
				FPort:       getRecordInt(r, "fport"),
				PayloadType: r.GetString("payload_type"),
				Delivery:    r.GetString("delivery"),
				CommandKey:  r.GetString("command_key"),
			})
		}
	}

	// Decode rules
	if rules, err := app.FindRecordsByFilter("device_decode_rules",
		"device_eui = {:eui}", "fport", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range rules {
			var cfg map[string]any
			cfgRaw := r.Get("config")
			switch v := cfgRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &cfg)
			case map[string]any:
				cfg = v
			}
			spec.DecodeRules = append(spec.DecodeRules, DecodeRule{
				FPort:  getRecordInt(r, "fport"),
				Format: r.GetString("format"),
				Config: cfg,
			})
		}
	}

	// AirConfig
	if ac, err := app.FindFirstRecordByFilter("device_airconfig",
		"device_eui = {:eui}", dbx.Params{"eui": devEUI}); err == nil {
		spec.AirConfig = &AirConfig{
			PinMap:     getRawJSON(ac, "pin_map"),
			Sensors:    getRawJSON(ac, "sensors"),
			Controls:   getRawJSON(ac, "controls"),
			LoRaWAN:    getRawJSON(ac, "lorawan"),
			Transfer:   getRawJSON(ac, "transfer"),
			ConfigHash: ac.GetString("config_hash"),
		}
	}

	// Visualizations
	if vizs, err := app.FindRecordsByFilter("device_visualizations",
		"device_eui = {:eui}", "sort_order", 0, 0, dbx.Params{"eui": devEUI}); err == nil {
		for _, r := range vizs {
			var cfg map[string]any
			cfgRaw := r.Get("config")
			switch v := cfgRaw.(type) {
			case string:
				_ = json.Unmarshal([]byte(v), &cfg)
			case map[string]any:
				cfg = v
			}
			spec.Visualizations = append(spec.Visualizations, SpecVisualization{
				Name:      r.GetString("name"),
				VizType:   r.GetString("viz_type"),
				Config:    cfg,
				SortOrder: getRecordInt(r, "sort_order"),
			})
		}
	}

	// Ensure non-nil slices for clean JSON
	if spec.Fields == nil {
		spec.Fields = []SpecField{}
	}
	if spec.Controls == nil {
		spec.Controls = []SpecControl{}
	}
	if spec.Commands == nil {
		spec.Commands = []SpecCommand{}
	}
	if spec.DecodeRules == nil {
		spec.DecodeRules = []DecodeRule{}
	}
	if spec.Visualizations == nil {
		spec.Visualizations = []SpecVisualization{}
	}

	return spec, nil
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// deleteDeviceRecords deletes all records in a collection matching a device_eui.
func deleteDeviceRecords(app core.App, devEUI, collection, euiField string) {
	recs, err := app.FindRecordsByFilter(collection,
		euiField+" = {:eui}", "", 0, 0, dbx.Params{"eui": devEUI})
	if err != nil {
		return
	}
	for _, rec := range recs {
		_ = app.Delete(rec)
	}
}

// computeConfigHash computes a CRC32 hex hash of the airconfig JSON components.
func computeConfigHash(ac *AirConfig) string {
	if ac == nil {
		return ""
	}
	h := crc32.NewIEEE()
	h.Write(ac.PinMap)
	h.Write(ac.Sensors)
	h.Write(ac.Controls)
	h.Write(ac.LoRaWAN)
	h.Write(ac.Transfer)
	return fmt.Sprintf("%08x", h.Sum32())
}

// specFieldsToMapping converts spec fields to FieldMapping for the decode engine.
func specFieldsToMapping(fields []SpecField) []FieldMapping {
	out := make([]FieldMapping, len(fields))
	for i, f := range fields {
		out[i] = FieldMapping{Index: f.SortOrder, Key: f.Key}
	}
	return out
}

// sortedFieldKeys returns field keys sorted by sort_order.
func sortedFieldKeys(fields []SpecField) []string {
	sorted := make([]SpecField, len(fields))
	copy(sorted, fields)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].SortOrder < sorted[j].SortOrder })
	keys := make([]string, len(sorted))
	for i, f := range sorted {
		keys[i] = f.Key
	}
	return keys
}

// derivePinMap computes a pin map from sensor and control configurations.
func derivePinMap(ac *AirConfig) ([]int, error) {
	if ac == nil {
		return nil, fmt.Errorf("no airconfig")
	}

	pinMap := make([]int, settings.MaxPins)
	if len(ac.PinMap) > 0 {
		var existing []int
		if err := json.Unmarshal(ac.PinMap, &existing); err == nil {
			copy(pinMap, existing)
		}
	}

	catInterfaces := catalog.Interfaces
	sensorTypeToPinFn := make(map[uint8]uint8)
	for _, iface := range catInterfaces {
		if iface.PinFunction > 0 {
			sensorTypeToPinFn[iface.SensorType] = iface.PinFunction
		}
	}

	var sensors []struct {
		Type     int `json:"type"`
		PinIndex int `json:"pin_index"`
	}
	if len(ac.Sensors) > 0 {
		_ = json.Unmarshal(ac.Sensors, &sensors)
	}
	for _, s := range sensors {
		st := settings.SensorType(s.Type)
		if st == settings.SensorBME280 || st == settings.SensorINA219 || st == settings.SensorModbusRTU {
			continue
		}
		if reqFn, ok := sensorTypeToPinFn[uint8(s.Type)]; ok && s.PinIndex < len(pinMap) {
			pinMap[s.PinIndex] = int(reqFn)
		}
	}

	var controls []struct {
		PinIndex  int `json:"pin_index"`
		Pin2Index int `json:"pin2_index"`
		Flags     int `json:"flags"`
	}
	if len(ac.Controls) > 0 {
		_ = json.Unmarshal(ac.Controls, &controls)
	}
	for _, c := range controls {
		if c.PinIndex < len(pinMap) {
			pinMap[c.PinIndex] = int(settings.PinRelay)
		}
		if c.Flags&0x04 != 0 && c.Pin2Index != 0xFF && c.Pin2Index != 255 && c.Pin2Index < len(pinMap) {
			pinMap[c.Pin2Index] = int(settings.PinRelay)
		}
	}

	return pinMap, nil
}

// ── Utility helpers ─────────────────────────────────────────────────────────

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
