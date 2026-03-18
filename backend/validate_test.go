package main

import (
	"encoding/json"
	"testing"
)

func makeAC(pinMap []int, sensors string, controls string) *ProfileAirConfig {
	pm, _ := json.Marshal(pinMap)
	ac := &ProfileAirConfig{
		PinMap:   pm,
		Sensors:  json.RawMessage(sensors),
		Controls: json.RawMessage(controls),
	}
	return ac
}

func hasCode(errs []ValidationError, code string) bool {
	for _, e := range errs {
		if e.Code == code {
			return true
		}
	}
	return false
}

func TestPinConflict(t *testing.T) {
	// Two sensors on same pin
	ac := makeAC(
		[]int{0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":7,"pin_index":4,"field_index":0,"flags":1},{"type":8,"pin_index":4,"field_index":1,"flags":1}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "pin_conflict") {
		t.Errorf("expected pin_conflict, got %+v", errs)
	}
}

func TestNoPinConflict(t *testing.T) {
	// Two sensors on different pins
	ac := makeAC(
		[]int{0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":7,"pin_index":3,"field_index":0,"flags":1},{"type":8,"pin_index":4,"field_index":1,"flags":1}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if hasCode(errs, "pin_conflict") {
		t.Errorf("unexpected pin_conflict: %+v", errs)
	}
}

func TestFieldOverlap(t *testing.T) {
	// BME280 at field_index=2 (occupies 2,3,4) + DS18B20 at field_index=3
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":2,"flags":1},{"type":3,"pin_index":7,"field_index":3,"flags":1}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "field_overlap") {
		t.Errorf("expected field_overlap, got %+v", errs)
	}
}

func TestNoFieldOverlap(t *testing.T) {
	// BME280 at field_index=0 (occupies 0,1,2) + DS18B20 at field_index=3
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":0,"flags":1},{"type":3,"pin_index":7,"field_index":3,"flags":1}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if hasCode(errs, "field_overlap") {
		t.Errorf("unexpected field_overlap: %+v", errs)
	}
}

func TestI2CAddrCollision(t *testing.T) {
	// Two BME280 on same bus with same address
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":0,"flags":1,"param1":118},{"type":5,"pin_index":0,"field_index":3,"flags":1,"param1":118}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "i2c_addr_collision") {
		t.Errorf("expected i2c_addr_collision, got %+v", errs)
	}
}

func TestNoI2CAddrCollision(t *testing.T) {
	// Two BME280 on same bus with different addresses
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":0,"flags":1,"param1":118},{"type":5,"pin_index":0,"field_index":3,"flags":1,"param1":119}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if hasCode(errs, "i2c_addr_collision") {
		t.Errorf("unexpected i2c_addr_collision: %+v", errs)
	}
}

func TestBusMissing(t *testing.T) {
	// I2C sensor referencing bus 0, but no SDA/SCL pins
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":0,"flags":1,"param1":118}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "bus_missing") {
		t.Errorf("expected bus_missing, got %+v", errs)
	}
}

func TestBusExists(t *testing.T) {
	// I2C sensor referencing bus 0, with SDA/SCL pins
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":5,"pin_index":0,"field_index":0,"flags":1,"param1":118}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if hasCode(errs, "bus_missing") {
		t.Errorf("unexpected bus_missing: %+v", errs)
	}
}

func TestPinFunctionMismatch(t *testing.T) {
	// ADC sensor on pin 4, but pin 4 is set to PinNone (0) instead of PinADC (4)
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":7,"pin_index":4,"field_index":0,"flags":1}]`,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "pin_function_mismatch") {
		t.Errorf("expected pin_function_mismatch, got %+v", errs)
	}
}

func TestControlPinMismatch(t *testing.T) {
	// Control on pin 8, but pin 8 is not PinRelay (2)
	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[]`,
		`[{"pin_index":8,"state_count":2,"flags":1,"actuator_type":0,"pin2_index":255}]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "control_pin_mismatch") {
		t.Errorf("expected control_pin_mismatch, got %+v", errs)
	}
}

func TestSlotLimits(t *testing.T) {
	// 33 sensors (exceeds MaxSensors=32)
	sensors := `[`
	for i := 0; i < 33; i++ {
		if i > 0 {
			sensors += ","
		}
		sensors += `{"type":11,"pin_index":0,"field_index":` + string(rune('0'+i%10)) + `,"flags":1}`
	}
	sensors += `]`

	ac := makeAC(
		[]int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		sensors,
		`[]`,
	)
	errs := ValidateAirConfig(ac)
	if !hasCode(errs, "slot_limit") {
		t.Errorf("expected slot_limit, got %+v", errs)
	}
}

func TestCleanConfig(t *testing.T) {
	// Water Monitor config — should be clean
	ac := makeAC(
		[]int{0, 0, 0, 0, 7, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		`[{"type":1,"pin_index":4,"field_index":0,"flags":1,"param1":450}]`,
		`[{"pin_index":8,"state_count":2,"flags":1,"actuator_type":0,"pin2_index":255,"pulse_x100ms":0},{"pin_index":9,"state_count":2,"flags":1,"actuator_type":0,"pin2_index":255,"pulse_x100ms":0}]`,
	)
	errs := ValidateAirConfig(ac)
	// Filter only errors (not warnings)
	var errors []ValidationError
	for _, e := range errs {
		if e.Severity == "error" {
			errors = append(errors, e)
		}
	}
	if len(errors) > 0 {
		t.Errorf("expected clean config, got errors: %+v", errors)
	}
}
