package main

import (
	"encoding/json"
	"fmt"

	"github.com/kisinga/farmon/firmware/pkg/catalog"
	"github.com/kisinga/farmon/firmware/pkg/settings"
)

// ValidationError describes a single validation issue in an airconfig.
type ValidationError struct {
	Severity string         `json:"severity"` // "error" or "warning"
	Code     string         `json:"code"`
	Message  string         `json:"message"`
	Details  map[string]any `json:"details,omitempty"`
}

// AirConfigForValidation is the parsed form of an airconfig used for validation.
type AirConfigForValidation struct {
	PinMap   []int                  `json:"pin_map"`
	Sensors  []SensorConfigParsed   `json:"sensors"`
	Controls []ControlConfigParsed  `json:"controls"`
}

// SensorConfigParsed is a parsed sensor config entry from airconfig JSON.
type SensorConfigParsed struct {
	Type       int  `json:"type"`
	PinIndex   int  `json:"pin_index"`
	FieldIndex int  `json:"field_index"`
	Flags      int  `json:"flags"`
	Param1     int  `json:"param1"`
	Param2     int  `json:"param2"`
}

func (s *SensorConfigParsed) Enabled() bool { return s.Flags&0x01 != 0 }

// ControlConfigParsed is a parsed control config entry from airconfig JSON.
type ControlConfigParsed struct {
	PinIndex     int `json:"pin_index"`
	StateCount   int `json:"state_count"`
	Flags        int `json:"flags"`
	ActuatorType int `json:"actuator_type"`
	Pin2Index    int `json:"pin2_index"`
	PulseX100ms  int `json:"pulse_x100ms"`
}

func (c *ControlConfigParsed) Enabled() bool { return c.Flags&0x01 != 0 }
func (c *ControlConfigParsed) DualPin() bool { return c.Flags&0x04 != 0 }

// parseAirConfigForValidation parses raw airconfig JSON into a validation-friendly struct.
func parseAirConfigForValidation(ac *AirConfig) (*AirConfigForValidation, error) {
	if ac == nil {
		return nil, fmt.Errorf("no airconfig")
	}
	var parsed AirConfigForValidation
	if len(ac.PinMap) > 0 {
		if err := json.Unmarshal(ac.PinMap, &parsed.PinMap); err != nil {
			return nil, fmt.Errorf("pin_map: %w", err)
		}
	}
	if len(ac.Sensors) > 0 {
		if err := json.Unmarshal(ac.Sensors, &parsed.Sensors); err != nil {
			return nil, fmt.Errorf("sensors: %w", err)
		}
	}
	if len(ac.Controls) > 0 {
		if err := json.Unmarshal(ac.Controls, &parsed.Controls); err != nil {
			return nil, fmt.Errorf("controls: %w", err)
		}
	}
	return &parsed, nil
}

// ValidateAirConfig runs all validation rules on a parsed airconfig and returns any issues found.
func ValidateAirConfig(ac *AirConfig) []ValidationError {
	parsed, err := parseAirConfigForValidation(ac)
	if err != nil {
		return []ValidationError{{Severity: "error", Code: "parse_error", Message: err.Error()}}
	}

	var errs []ValidationError
	errs = append(errs, validateSlotLimits(parsed)...)
	errs = append(errs, validatePinConflicts(parsed)...)
	errs = append(errs, validateFieldOverlaps(parsed)...)
	errs = append(errs, validateI2CAddrCollisions(parsed)...)
	errs = append(errs, validateBusExists(parsed)...)
	errs = append(errs, validatePinFunctions(parsed)...)
	errs = append(errs, validateControlPinFunctions(parsed)...)
	return errs
}

// --- Rule 7: Slot limits ---

func validateSlotLimits(ac *AirConfigForValidation) []ValidationError {
	var errs []ValidationError
	if len(ac.Sensors) > settings.MaxSensors {
		errs = append(errs, ValidationError{
			Severity: "error", Code: "slot_limit",
			Message: fmt.Sprintf("sensor count %d exceeds maximum %d", len(ac.Sensors), settings.MaxSensors),
		})
	}
	if len(ac.Controls) > settings.MaxControls {
		errs = append(errs, ValidationError{
			Severity: "error", Code: "slot_limit",
			Message: fmt.Sprintf("control count %d exceeds maximum %d", len(ac.Controls), settings.MaxControls),
		})
	}
	return errs
}

// --- Rule 1: Pin conflict detection ---

func validatePinConflicts(ac *AirConfigForValidation) []ValidationError {
	// Track which slots use each pin. I2C SDA/SCL pins are shared by bus, so we skip them.
	type pinUser struct {
		kind string // "sensor" or "control"
		slot int
	}
	pinUsers := make(map[int][]pinUser)

	for i, s := range ac.Sensors {
		if !s.Enabled() {
			continue
		}
		st := settings.SensorType(s.Type)
		// Bus-addressed sensors (I2C, Modbus) don't claim a GPIO pin directly
		if isBusAddressed(st) {
			continue
		}
		pinUsers[s.PinIndex] = append(pinUsers[s.PinIndex], pinUser{"sensor", i})
	}
	for i, c := range ac.Controls {
		if !c.Enabled() {
			continue
		}
		pinUsers[c.PinIndex] = append(pinUsers[c.PinIndex], pinUser{"control", i})
		if c.DualPin() && c.Pin2Index != 0xFF && c.Pin2Index != 255 {
			pinUsers[c.Pin2Index] = append(pinUsers[c.Pin2Index], pinUser{"control", i})
		}
	}

	var errs []ValidationError
	for pin, users := range pinUsers {
		if len(users) > 1 {
			descs := make([]string, len(users))
			for j, u := range users {
				descs[j] = fmt.Sprintf("%s slot %d", u.kind, u.slot)
			}
			errs = append(errs, ValidationError{
				Severity: "error", Code: "pin_conflict",
				Message: fmt.Sprintf("pin %d used by multiple slots: %v", pin, descs),
				Details: map[string]any{"pin": pin, "users": descs},
			})
		}
	}
	return errs
}

// --- Rule 2: Field index overlap detection ---

func validateFieldOverlaps(ac *AirConfigForValidation) []ValidationError {
	type fieldRange struct {
		slot  int
		start int
		count int
	}
	var ranges []fieldRange
	for i, s := range ac.Sensors {
		if !s.Enabled() {
			continue
		}
		fc := catalog.FieldCountForType(settings.SensorType(s.Type))
		ranges = append(ranges, fieldRange{slot: i, start: s.FieldIndex, count: fc})
	}

	var errs []ValidationError
	for i := 0; i < len(ranges); i++ {
		for j := i + 1; j < len(ranges); j++ {
			a, b := ranges[i], ranges[j]
			// Check overlap: [a.start, a.start+a.count) overlaps [b.start, b.start+b.count)
			if a.start < b.start+b.count && b.start < a.start+a.count {
				errs = append(errs, ValidationError{
					Severity: "error", Code: "field_overlap",
					Message: fmt.Sprintf("sensor slot %d (fields %d-%d) overlaps with slot %d (fields %d-%d)",
						a.slot, a.start, a.start+a.count-1,
						b.slot, b.start, b.start+b.count-1),
					Details: map[string]any{"slot_a": a.slot, "slot_b": b.slot},
				})
			}
		}
	}
	return errs
}

// --- Rule 3: I2C address collision ---

func validateI2CAddrCollisions(ac *AirConfigForValidation) []ValidationError {
	type i2cKey struct {
		bus  int
		addr int
	}
	seen := make(map[i2cKey]int) // key → first slot index
	var errs []ValidationError

	for i, s := range ac.Sensors {
		if !s.Enabled() {
			continue
		}
		st := settings.SensorType(s.Type)
		if !isI2CSensor(st) {
			continue
		}
		addr := s.Param1 & 0xFF // low byte = I2C address
		key := i2cKey{bus: s.PinIndex, addr: addr}
		if prev, ok := seen[key]; ok {
			errs = append(errs, ValidationError{
				Severity: "error", Code: "i2c_addr_collision",
				Message: fmt.Sprintf("sensor slots %d and %d both use I2C bus %d address 0x%02X", prev, i, s.PinIndex, addr),
				Details: map[string]any{"bus": s.PinIndex, "addr": addr, "slot_a": prev, "slot_b": i},
			})
		} else {
			seen[key] = i
		}
	}
	return errs
}

// --- Rule 4: Bus existence validation ---

func validateBusExists(ac *AirConfigForValidation) []ValidationError {
	// Discover which I2C and UART buses exist from pin map (sequential scan like firmware)
	i2cBuses := discoverI2CBuses(ac.PinMap)
	uartBuses := discoverUARTBuses(ac.PinMap)

	var errs []ValidationError
	for i, s := range ac.Sensors {
		if !s.Enabled() {
			continue
		}
		st := settings.SensorType(s.Type)
		if isI2CSensor(st) {
			if s.PinIndex >= len(i2cBuses) || !i2cBuses[s.PinIndex] {
				errs = append(errs, ValidationError{
					Severity: "error", Code: "bus_missing",
					Message: fmt.Sprintf("sensor slot %d references I2C bus %d but no SDA/SCL pins are configured for it", i, s.PinIndex),
					Details: map[string]any{"slot": i, "bus_type": "i2c", "bus_index": s.PinIndex},
				})
			}
		}
		if st == settings.SensorModbusRTU {
			if s.PinIndex >= len(uartBuses) || !uartBuses[s.PinIndex] {
				errs = append(errs, ValidationError{
					Severity: "error", Code: "bus_missing",
					Message: fmt.Sprintf("sensor slot %d references UART bus %d but no TX/RX pins are configured for it", i, s.PinIndex),
					Details: map[string]any{"slot": i, "bus_type": "uart", "bus_index": s.PinIndex},
				})
			}
		}
	}
	return errs
}

// --- Rule 5: Pin function mismatch (sensors) ---

func validatePinFunctions(ac *AirConfigForValidation) []ValidationError {
	if len(ac.PinMap) == 0 {
		return nil // no pin map to validate against
	}

	var errs []ValidationError
	for i, s := range ac.Sensors {
		if !s.Enabled() {
			continue
		}
		st := settings.SensorType(s.Type)
		if isBusAddressed(st) {
			continue // bus sensors use bus index, not GPIO pin
		}
		required := requiredPinFunction(st)
		if required == settings.PinNone {
			continue
		}
		if s.PinIndex >= len(ac.PinMap) {
			errs = append(errs, ValidationError{
				Severity: "error", Code: "pin_function_mismatch",
				Message: fmt.Sprintf("sensor slot %d references pin %d which is out of range (max %d)", i, s.PinIndex, len(ac.PinMap)-1),
			})
			continue
		}
		actual := settings.PinFunction(ac.PinMap[s.PinIndex])
		if actual != required {
			errs = append(errs, ValidationError{
				Severity: "warning", Code: "pin_function_mismatch",
				Message: fmt.Sprintf("sensor slot %d (type %d) needs pin %d as %s but pin map has %s",
					i, s.Type, s.PinIndex, settings.PinFunctionName(required), settings.PinFunctionName(actual)),
				Details: map[string]any{"slot": i, "pin": s.PinIndex, "expected": int(required), "actual": int(actual)},
			})
		}
	}
	return errs
}

// --- Rule 6: Control pin function mismatch ---

func validateControlPinFunctions(ac *AirConfigForValidation) []ValidationError {
	if len(ac.PinMap) == 0 {
		return nil
	}
	var errs []ValidationError
	for i, c := range ac.Controls {
		if !c.Enabled() {
			continue
		}
		if c.PinIndex >= len(ac.PinMap) {
			errs = append(errs, ValidationError{
				Severity: "error", Code: "control_pin_mismatch",
				Message: fmt.Sprintf("control slot %d references pin %d which is out of range", i, c.PinIndex),
			})
			continue
		}
		actual := settings.PinFunction(ac.PinMap[c.PinIndex])
		if actual != settings.PinRelay {
			errs = append(errs, ValidationError{
				Severity: "warning", Code: "control_pin_mismatch",
				Message: fmt.Sprintf("control slot %d needs pin %d as Relay but pin map has %s",
					i, c.PinIndex, settings.PinFunctionName(actual)),
				Details: map[string]any{"slot": i, "pin": c.PinIndex, "actual": int(actual)},
			})
		}
		if c.DualPin() && c.Pin2Index != 0xFF && c.Pin2Index != 255 {
			if int(c.Pin2Index) >= len(ac.PinMap) {
				errs = append(errs, ValidationError{
					Severity: "error", Code: "control_pin_mismatch",
					Message: fmt.Sprintf("control slot %d pin2 %d is out of range", i, c.Pin2Index),
				})
			} else if settings.PinFunction(ac.PinMap[c.Pin2Index]) != settings.PinRelay {
				errs = append(errs, ValidationError{
					Severity: "warning", Code: "control_pin_mismatch",
					Message: fmt.Sprintf("control slot %d needs pin2 %d as Relay but pin map has %s",
						i, c.Pin2Index, settings.PinFunctionName(settings.PinFunction(ac.PinMap[c.Pin2Index]))),
				})
			}
		}
	}
	return errs
}

// --- Helpers ---

func isBusAddressed(st settings.SensorType) bool {
	return st == settings.SensorBME280 || st == settings.SensorINA219 || st == settings.SensorModbusRTU
}

func isI2CSensor(st settings.SensorType) bool {
	return st == settings.SensorBME280 || st == settings.SensorINA219
}

// requiredPinFunction returns the pin function required for a direct-pin sensor type.
func requiredPinFunction(st settings.SensorType) settings.PinFunction {
	switch st {
	case settings.SensorFlowYFS201:
		return settings.PinFlowSensor
	case settings.SensorBatteryADC, settings.SensorSoilADC, settings.SensorADCLinear, settings.SensorADC4_20mA:
		return settings.PinADC
	case settings.SensorDS18B20:
		return settings.PinOneWire
	case settings.SensorPulseGeneric:
		return settings.PinCounter
	case settings.SensorDigitalIn:
		return settings.PinButton
	default:
		return settings.PinNone
	}
}

// discoverI2CBuses scans pin map for adjacent SDA+SCL pairs (matches firmware BusRegistry logic).
func discoverI2CBuses(pinMap []int) []bool {
	buses := make([]bool, 2)
	busIdx := 0
	for i := 0; i < len(pinMap)-1 && busIdx < 2; i++ {
		if settings.PinFunction(pinMap[i]) == settings.PinI2CSDA && settings.PinFunction(pinMap[i+1]) == settings.PinI2CSCL {
			buses[busIdx] = true
			busIdx++
			i++ // skip SCL pin
		}
	}
	return buses
}

// discoverUARTBuses scans pin map for adjacent TX+RX pairs (matches firmware BusRegistry logic).
func discoverUARTBuses(pinMap []int) []bool {
	buses := make([]bool, 2)
	busIdx := 0
	for i := 0; i < len(pinMap)-1 && busIdx < 2; i++ {
		if settings.PinFunction(pinMap[i]) == settings.PinUARTTX && settings.PinFunction(pinMap[i+1]) == settings.PinUARTRX {
			buses[busIdx] = true
			busIdx++
			i++ // skip RX pin
		}
	}
	return buses
}
