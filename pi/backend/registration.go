package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ---------------------------------------------------------------------------
// Registration frame assembler
// ---------------------------------------------------------------------------

// requiredFrameKeys are the 5 frame keys the device sends during registration.
var requiredFrameKeys = []string{"header", "fields", "sys", "states", "cmds"}

type registrationBuffer struct {
	frames    map[string]string
	startedAt time.Time
}

// RegistrationAssembler accumulates multi-frame registration payloads per device.
// Thread-safe; used from the pipeline goroutine.
type RegistrationAssembler struct {
	mu      sync.Mutex
	buffers map[string]*registrationBuffer
}

func NewRegistrationAssembler() *RegistrationAssembler {
	return &RegistrationAssembler{buffers: make(map[string]*registrationBuffer)}
}

const registrationBufferExpiry = 60 * time.Second

// Accumulate stores a registration frame. Returns true when all required frames are present.
func (ra *RegistrationAssembler) Accumulate(devEUI, frameKey, frameData string) bool {
	ra.mu.Lock()
	defer ra.mu.Unlock()

	buf, ok := ra.buffers[devEUI]
	if !ok || time.Since(buf.startedAt) > registrationBufferExpiry {
		buf = &registrationBuffer{
			frames:    make(map[string]string),
			startedAt: time.Now(),
		}
		ra.buffers[devEUI] = buf
	}
	buf.frames[frameKey] = frameData

	for _, k := range requiredFrameKeys {
		if _, exists := buf.frames[k]; !exists {
			return false
		}
	}
	return true
}

// Consume returns the assembled frames and removes the buffer entry.
func (ra *RegistrationAssembler) Consume(devEUI string) map[string]string {
	ra.mu.Lock()
	defer ra.mu.Unlock()
	buf, ok := ra.buffers[devEUI]
	if !ok {
		return nil
	}
	frames := buf.frames
	delete(ra.buffers, devEUI)
	return frames
}

// ---------------------------------------------------------------------------
// Parsed types
// ---------------------------------------------------------------------------

// ParsedField represents a field descriptor from registration.
type ParsedField struct {
	Key         string
	DisplayName string
	Unit        string
	Category    string // "telemetry" or "system"
	Access      string // "r" or "w"
	MinValue    float64
	MaxValue    float64
	StateClass  string // "m", "i", "d", "u"
	Index       int    // position in schema
}

// ParsedControl represents a control descriptor from registration.
type ParsedControl struct {
	Key         string
	DisplayName string
	States      []string
}

// ---------------------------------------------------------------------------
// Frame parsers
// ---------------------------------------------------------------------------

// parseHeaderFrame parses "v=1|sv=1|type=water_monitor|fw=2.0.0"
func parseHeaderFrame(data string) (deviceType, fwVersion string, schemaVersion int) {
	for _, part := range strings.Split(data, "|") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch strings.TrimSpace(kv[0]) {
		case "type":
			deviceType = strings.TrimSpace(kv[1])
		case "fw":
			fwVersion = strings.TrimSpace(kv[1])
		case "sv":
			schemaVersion, _ = strconv.Atoi(strings.TrimSpace(kv[1]))
		}
	}
	return
}

// unescapeUnit converts "%%" back to "%" (firmware escapes % for snprintf).
func unescapeUnit(s string) string {
	return strings.ReplaceAll(s, "%%", "%")
}

// parseFieldsFrame parses "fields=pd:PulseDelta::0:65535:d,tv:TotalVolume:L:0:999999:i"
// Format per item: key:name:unit:min:max:state_class (3-6 colon-separated parts)
func parseFieldsFrame(data string) []ParsedField {
	data = strings.TrimPrefix(data, "fields=")
	if data == "" {
		return nil
	}
	var fields []ParsedField
	for idx, item := range strings.Split(data, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.Split(item, ":")
		if len(parts) < 2 {
			continue
		}
		f := ParsedField{
			Key:         parts[0],
			DisplayName: parts[1],
			Category:    "telemetry",
			Access:      "r",
			Index:       idx,
		}
		// Variable-length parsing: key:name[:unit[:min:max]][:state_class]
		// Last single-char part is state_class
		if len(parts) >= 3 {
			last := parts[len(parts)-1]
			if len(last) == 1 && (last == "m" || last == "i" || last == "d" || last == "u") {
				f.StateClass = last
				parts = parts[:len(parts)-1] // remove state_class from parts
			}
		}
		if len(parts) >= 3 {
			f.Unit = unescapeUnit(parts[2])
		}
		if len(parts) >= 5 {
			f.MinValue, _ = strconv.ParseFloat(parts[3], 64)
			f.MaxValue, _ = strconv.ParseFloat(parts[4], 64)
		}
		fields = append(fields, f)
	}
	return fields
}

// parseSystemFrame parses "sys=bp:Bat:%:::r:m,tx:TxInt:s:10:3600:w:m"
// Format per item: key:name:unit:min:max:access:state_class (4-7 colon-separated parts)
func parseSystemFrame(data string) []ParsedField {
	data = strings.TrimPrefix(data, "sys=")
	if data == "" {
		return nil
	}
	var fields []ParsedField
	for idx, item := range strings.Split(data, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.Split(item, ":")
		if len(parts) < 2 {
			continue
		}
		f := ParsedField{
			Key:         parts[0],
			DisplayName: parts[1],
			Category:    "system",
			Access:      "r",
			Index:       idx,
		}
		// System format: key:name:unit:min:max:access:state_class
		// Parts can be empty (e.g., "bp:Bat:%:::r:m")
		// Last single-char is state_class, second-to-last is access (r/w)
		if len(parts) >= 3 {
			f.Unit = unescapeUnit(parts[2])
		}
		// Find access and state_class from the end
		if len(parts) >= 4 {
			last := parts[len(parts)-1]
			if len(last) == 1 && (last == "m" || last == "i" || last == "d" || last == "u") {
				f.StateClass = last
			}
			// Access is the part before state_class
			if len(parts) >= 5 {
				accessPart := parts[len(parts)-2]
				if accessPart == "r" || accessPart == "w" {
					f.Access = accessPart
				}
			}
		}
		// min/max are parts[3] and parts[4] if they look numeric
		if len(parts) >= 5 {
			if parts[3] != "" {
				f.MinValue, _ = strconv.ParseFloat(parts[3], 64)
			}
			if parts[4] != "" {
				f.MaxValue, _ = strconv.ParseFloat(parts[4], 64)
			}
		}
		fields = append(fields, f)
	}
	return fields
}

// parseStatesFrame parses "states=pump:Water Pump:off;on,valve:Valve:closed;open"
func parseStatesFrame(data string) []ParsedControl {
	data = strings.TrimPrefix(data, "states=")
	if data == "" {
		return nil
	}
	var controls []ParsedControl
	for _, item := range strings.Split(data, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.SplitN(item, ":", 3)
		if len(parts) < 3 {
			continue
		}
		states := strings.Split(parts[2], ";")
		controls = append(controls, ParsedControl{
			Key:         parts[0],
			DisplayName: parts[1],
			States:      states,
		})
	}
	return controls
}

// parseCmdsFrame parses "cmds=reset:10,interval:11,reboot:12,..."
func parseCmdsFrame(data string) map[string]int {
	data = strings.TrimPrefix(data, "cmds=")
	if data == "" {
		return nil
	}
	cmds := make(map[string]int)
	for _, item := range strings.Split(data, ",") {
		item = strings.TrimSpace(item)
		parts := strings.SplitN(item, ":", 2)
		if len(parts) != 2 {
			continue
		}
		port, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			continue
		}
		cmds[strings.TrimSpace(parts[0])] = port
	}
	return cmds
}

// ---------------------------------------------------------------------------
// Registration persistence
// ---------------------------------------------------------------------------

func upsertDeviceField(app core.App, devEUI string, f ParsedField) error {
	coll, err := app.FindCollectionByNameOrId("device_fields")
	if err != nil {
		return err
	}
	existing, err := app.FindFirstRecordByFilter("device_fields",
		"device_eui = {:eui} && field_key = {:key}",
		dbx.Params{"eui": devEUI, "key": f.Key})

	dataType := "number" // firmware uses FLOAT/UINT32/INT32
	rec := existing
	if err != nil {
		// Create new
		rec = core.NewRecord(coll)
		rec.Set("device_eui", devEUI)
		rec.Set("field_key", f.Key)
	}
	rec.Set("display_name", f.DisplayName)
	rec.Set("data_type", dataType)
	rec.Set("unit", f.Unit)
	rec.Set("category", f.Category)
	rec.Set("access", f.Access)
	rec.Set("state_class", f.StateClass)
	rec.Set("field_idx", f.Index)
	if f.MinValue != 0 || f.MaxValue != 0 {
		rec.Set("min_value", f.MinValue)
		rec.Set("max_value", f.MaxValue)
	}
	return app.Save(rec)
}

func upsertDeviceControlFromReg(app core.App, devEUI string, c ParsedControl, idx int) error {
	coll, err := app.FindCollectionByNameOrId("device_controls")
	if err != nil {
		return err
	}
	existing, err := app.FindFirstRecordByFilter("device_controls",
		"device_eui = {:eui} && control_key = {:key}",
		dbx.Params{"eui": devEUI, "key": c.Key})

	statesJSON, _ := json.Marshal(c.States)

	rec := existing
	if err != nil {
		// Create new — set initial state to first state name
		rec = core.NewRecord(coll)
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
	rec.Set("control_idx", idx)
	return app.Save(rec)
}

func updateDeviceMetadata(app core.App, devEUI, deviceType, fwVersion string) error {
	existing, err := app.FindFirstRecordByFilter("devices",
		"device_eui = {:eui}",
		dbx.Params{"eui": devEUI})
	if err != nil {
		return err
	}
	if deviceType != "" {
		existing.Set("device_type", deviceType)
	}
	if fwVersion != "" {
		existing.Set("firmware_version", fwVersion)
	}
	return app.Save(existing)
}

func upsertDeviceCommands(app core.App, devEUI string, cmds map[string]int) error {
	existing, err := app.FindFirstRecordByFilter("devices",
		"device_eui = {:eui}",
		dbx.Params{"eui": devEUI})
	if err != nil {
		return err
	}
	cmdsJSON, _ := json.Marshal(cmds)
	existing.Set("commands_json", string(cmdsJSON))
	return app.Save(existing)
}

// lookupControlKey returns the control_key for a given control_idx, or "control_N" as fallback.
func lookupControlKey(app core.App, devEUI string, ctrlIdx int) string {
	rec, err := app.FindFirstRecordByFilter("device_controls",
		"device_eui = {:eui} && control_idx = {:idx}",
		dbx.Params{"eui": devEUI, "idx": ctrlIdx})
	if err != nil {
		return fmt.Sprintf("control_%d", ctrlIdx)
	}
	if key, ok := rec.Get("control_key").(string); ok && key != "" {
		return key
	}
	return fmt.Sprintf("control_%d", ctrlIdx)
}

// ---------------------------------------------------------------------------
// Process complete registration
// ---------------------------------------------------------------------------

// processRegistration parses all 5 frames and persists to DB.
func processRegistration(app core.App, devEUI string, frames map[string]string) error {
	// Parse header
	deviceType, fwVersion, schemaVersion := parseHeaderFrame(frames["header"])
	log.Printf("registration: dev_eui=%s type=%s fw=%s sv=%d", devEUI, deviceType, fwVersion, schemaVersion)

	// Parse fields (telemetry)
	telemetryFields := parseFieldsFrame(frames["fields"])
	// Parse system fields
	systemFields := parseSystemFrame(frames["sys"])
	// Parse controls
	controls := parseStatesFrame(frames["states"])
	// Parse commands
	cmds := parseCmdsFrame(frames["cmds"])

	// Update device metadata
	if err := updateDeviceMetadata(app, devEUI, deviceType, fwVersion); err != nil {
		log.Printf("registration: updateDeviceMetadata error: %v", err)
	}

	// Upsert telemetry fields (indices relative to telemetry category)
	for _, f := range telemetryFields {
		if err := upsertDeviceField(app, devEUI, f); err != nil {
			log.Printf("registration: upsertDeviceField %s error: %v", f.Key, err)
		}
	}

	// Upsert system fields (indices continue after telemetry fields)
	for i, f := range systemFields {
		f.Index = len(telemetryFields) + i
		if err := upsertDeviceField(app, devEUI, f); err != nil {
			log.Printf("registration: upsertDeviceField %s error: %v", f.Key, err)
		}
	}

	// Upsert controls
	for i, c := range controls {
		if err := upsertDeviceControlFromReg(app, devEUI, c, i); err != nil {
			log.Printf("registration: upsertDeviceControlFromReg %s error: %v", c.Key, err)
		}
	}

	// Store commands mapping
	if len(cmds) > 0 {
		if err := upsertDeviceCommands(app, devEUI, cmds); err != nil {
			log.Printf("registration: upsertDeviceCommands error: %v", err)
		}
	}

	log.Printf("registration: complete dev_eui=%s fields=%d sys=%d controls=%d cmds=%d",
		devEUI, len(telemetryFields), len(systemFields), len(controls), len(cmds))
	return nil
}
