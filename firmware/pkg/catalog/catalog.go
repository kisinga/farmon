// Package catalog is the single source of truth for IO interface metadata.
// It is imported by the backend and served as JSON at GET /api/farmon/io-catalog.
// The frontend fetches from that endpoint instead of maintaining its own copy.
//
// This package lives outside firmware/pkg/sensors (which imports "machine")
// so that standard Go tooling (go vet, go build) can compile it without TinyGo.
package catalog

import "github.com/kisinga/farmon/firmware/pkg/settings"

// ─── Sensor interfaces ──────────────────────────────────────────────────────

// InterfaceInfo describes a sensor interface category for the UI.
type InterfaceInfo struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	SensorType      uint8   `json:"sensor_type"`
	NeedsCalib      bool    `json:"needs_calib"`
	BusAddressed    bool    `json:"bus_addressed"`
	PinFunction     uint8   `json:"pin_function"`      // required pin function for direct-pin sensors (0 = N/A)
	BusPinFunctions []uint8 `json:"bus_pin_functions"`  // required bus pin functions (e.g., [SDA, SCL] for I2C)
}

// Interfaces is the authoritative list of sensor interface types.
var Interfaces = []InterfaceInfo{
	{ID: "adc_linear", Label: "Analog (0-VREF Linear)", SensorType: uint8(settings.SensorADCLinear), NeedsCalib: true, BusAddressed: false, PinFunction: uint8(settings.PinADC)},
	{ID: "adc_4_20ma", Label: "Analog (4-20mA Loop)", SensorType: uint8(settings.SensorADC4_20mA), NeedsCalib: true, BusAddressed: false, PinFunction: uint8(settings.PinADC)},
	{ID: "onewire", Label: "1-Wire (DS18B20)", SensorType: uint8(settings.SensorDS18B20), NeedsCalib: false, BusAddressed: false, PinFunction: uint8(settings.PinOneWire)},
	{ID: "i2c_bme280", Label: "I2C — BME280 (T/H/P)", SensorType: uint8(settings.SensorBME280), NeedsCalib: false, BusAddressed: true, BusPinFunctions: []uint8{uint8(settings.PinI2CSDA), uint8(settings.PinI2CSCL)}},
	{ID: "i2c_ina219", Label: "I2C — INA219 (V/I/W)", SensorType: uint8(settings.SensorINA219), NeedsCalib: false, BusAddressed: true, BusPinFunctions: []uint8{uint8(settings.PinI2CSDA), uint8(settings.PinI2CSCL)}},
	{ID: "pulse", Label: "Pulse Counter", SensorType: uint8(settings.SensorPulseGeneric), NeedsCalib: false, BusAddressed: false, PinFunction: uint8(settings.PinCounter)},
	{ID: "modbus_rtu", Label: "Modbus RTU (RS-485)", SensorType: uint8(settings.SensorModbusRTU), NeedsCalib: false, BusAddressed: true, BusPinFunctions: []uint8{uint8(settings.PinUARTTX), uint8(settings.PinUARTRX)}},
	{ID: "digital_in", Label: "Digital Input (GPIO)", SensorType: uint8(settings.SensorDigitalIn), NeedsCalib: false, BusAddressed: false, PinFunction: uint8(settings.PinButton)},
}

// ─── Output interfaces ─────────────────────────────────────────────────────

// OutputInterfaceInfo describes an output/actuator interface category for the UI.
type OutputInterfaceInfo struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	ActuatorType   uint8  `json:"actuator_type"`
	PinFunction    uint8  `json:"pin_function"`      // required pin function (0 = bus-addressed)
	DualPin        bool   `json:"dual_pin"`           // true for motorized valve (open + close pins)
	BusAddressed   bool   `json:"bus_addressed"`      // true for I2C PWM
	HasPulse       bool   `json:"has_pulse"`          // solenoid, motorized valve
	Analog         bool   `json:"analog"`             // PWM, Servo, DAC, I2C PWM
	Hint           string `json:"hint"`               // short description for the UI
}

// OutputInterfaces is the authoritative list of output interface types.
var OutputInterfaces = []OutputInterfaceInfo{
	{ID: "relay", Label: "Relay / GPIO", ActuatorType: 0, PinFunction: uint8(settings.PinRelay), Hint: "Single pin toggled HIGH/LOW. For pumps, lights, contactors."},
	{ID: "motorized_valve", Label: "Motorized Valve", ActuatorType: 1, PinFunction: uint8(settings.PinRelay), DualPin: true, HasPulse: true, Hint: "Two pins: pulse one to open, the other to close."},
	{ID: "solenoid", Label: "Solenoid Valve", ActuatorType: 2, PinFunction: uint8(settings.PinRelay), HasPulse: true, Hint: "Single pin pulsed then released. For spring-return solenoid valves."},
	{ID: "pwm", Label: "PWM Output", ActuatorType: 3, PinFunction: uint8(settings.PinPWM), Analog: true, Hint: "PWM duty cycle 0–100%. For variable speed fans or dimmers."},
	{ID: "servo", Label: "Servo", ActuatorType: 4, PinFunction: uint8(settings.PinPWM), Analog: true, Hint: "Servo PWM (50 Hz). For throttle or ball valve positioning."},
	{ID: "dac", Label: "DAC Analog Output", ActuatorType: 5, PinFunction: uint8(settings.PinDAC), Analog: true, Hint: "True analog voltage output. STM32 only."},
	{ID: "i2c_pwm", Label: "I2C PWM (PCA9685)", ActuatorType: 6, BusAddressed: true, Analog: true, Hint: "PWM via I2C expander (PCA9685). No GPIO pin needed."},
}

// ─── Measurement types ──────────────────────────────────────────────────────

// MeasurementInfo describes a physical measurement category.
type MeasurementInfo struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Unit       string  `json:"unit"`
	DefaultMin float64 `json:"default_min"`
	DefaultMax float64 `json:"default_max"`
}

// Measurements is the authoritative list of measurement types.
var Measurements = []MeasurementInfo{
	{ID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 125},
	{ID: "humidity", Label: "Humidity", Unit: "%RH", DefaultMin: 0, DefaultMax: 100},
	{ID: "pressure", Label: "Pressure", Unit: "hPa", DefaultMin: 900, DefaultMax: 1100},
	{ID: "flow_rate", Label: "Flow Rate", Unit: "L/m", DefaultMin: 0, DefaultMax: 60},
	{ID: "volume", Label: "Volume", Unit: "L", DefaultMin: 0, DefaultMax: 1000},
	{ID: "co2", Label: "CO₂", Unit: "ppm", DefaultMin: 400, DefaultMax: 5000},
	{ID: "ph", Label: "pH", Unit: "pH", DefaultMin: 0, DefaultMax: 14},
	{ID: "level", Label: "Level", Unit: "cm", DefaultMin: 0, DefaultMax: 500},
	{ID: "current", Label: "Current", Unit: "A", DefaultMin: 0, DefaultMax: 10},
	{ID: "voltage", Label: "Voltage", Unit: "V", DefaultMin: 0, DefaultMax: 60},
	{ID: "power", Label: "Power", Unit: "W", DefaultMin: 0, DefaultMax: 500},
	{ID: "battery", Label: "Battery", Unit: "%", DefaultMin: 0, DefaultMax: 100},
	{ID: "soil_moisture", Label: "Soil Moisture", Unit: "%", DefaultMin: 0, DefaultMax: 100},
	{ID: "state", Label: "State (0/1)", Unit: "", DefaultMin: 0, DefaultMax: 1},
	{ID: "custom", Label: "Custom", Unit: "", DefaultMin: 0, DefaultMax: 100},
}

// ─── Sensor presets ─────────────────────────────────────────────────────────

// SensorPreset is a quick-start template for a specific sensor model.
type SensorPreset struct {
	ID             string  `json:"id"`
	Label          string  `json:"label"`
	Description    string  `json:"description,omitempty"`
	InterfaceID    string  `json:"interface"`
	MeasurementID  string  `json:"measurement"`
	FieldCount     int     `json:"field_count"`
	CalibMin       float64 `json:"calib_min"`
	CalibMax       float64 `json:"calib_max"`
	PulsesPerUnit  uint16  `json:"pulses_per_unit,omitempty"`
	I2CAddr        uint8   `json:"i2c_addr,omitempty"`
	ModbusDevAddr  uint8   `json:"modbus_dev_addr,omitempty"`
	ModbusFuncCode uint8   `json:"modbus_func_code,omitempty"`
}

// Presets is the authoritative list of sensor presets.
var Presets = []SensorPreset{
	{ID: "tl136", Label: "TL-136 Temperature (4-20mA)", Description: "Common 4-20mA temperature transmitter, -40–125°C", InterfaceID: "adc_4_20ma", MeasurementID: "temperature", FieldCount: 1, CalibMin: -40, CalibMax: 125},
	{ID: "yfs201", Label: "YF-S201 Water Flow (Pulse)", Description: "Pulse flow meter, 1–30 L/min, 450 pulses/L", InterfaceID: "pulse", MeasurementID: "flow_rate", FieldCount: 2, CalibMin: 0, CalibMax: 30, PulsesPerUnit: 450},
	{ID: "ds18b20", Label: "DS18B20 Temperature (1-Wire)", Description: "Waterproof digital temperature sensor, -55–125°C", InterfaceID: "onewire", MeasurementID: "temperature", FieldCount: 1, CalibMin: -55, CalibMax: 125},
	{ID: "bme280", Label: "BME280 Temp/Hum/Pressure (I2C)", Description: "Bosch environmental sensor; 3 fields (T/H/P)", InterfaceID: "i2c_bme280", MeasurementID: "temperature", FieldCount: 3, CalibMin: -40, CalibMax: 85, I2CAddr: 0x76},
	{ID: "ina219", Label: "INA219 Current/Voltage (I2C)", Description: "TI current sensor; 3 fields (V/I/W)", InterfaceID: "i2c_ina219", MeasurementID: "current", FieldCount: 3, CalibMin: 0, CalibMax: 3.2, I2CAddr: 0x40},
	{ID: "soil_cap", Label: "Capacitive Soil Moisture (ADC)", Description: "Generic capacitive soil sensor; calibrate dry/wet raw counts in device settings", InterfaceID: "adc_linear", MeasurementID: "soil_moisture", FieldCount: 1, CalibMin: 0, CalibMax: 100},
	{ID: "ph_4_20", Label: "pH Sensor (4-20mA)", Description: "Analog pH transmitter, 0–14 pH", InterfaceID: "adc_4_20ma", MeasurementID: "ph", FieldCount: 1, CalibMin: 0, CalibMax: 14},
	{ID: "level_4_20", Label: "Water Level (4-20mA)", Description: "Hydrostatic level transmitter, 0–5m", InterfaceID: "adc_4_20ma", MeasurementID: "level", FieldCount: 1, CalibMin: 0, CalibMax: 500},
	{ID: "float_switch", Label: "Float Switch (Digital)", Description: "Normally-open or normally-closed float switch on a GPIO pin", InterfaceID: "digital_in", MeasurementID: "state", FieldCount: 1, CalibMin: 0, CalibMax: 1},
	{ID: "door_sensor", Label: "Door / Reed Switch (Digital)", Description: "Magnetic reed switch: 0 = closed, 1 = open", InterfaceID: "digital_in", MeasurementID: "state", FieldCount: 1, CalibMin: 0, CalibMax: 1},
}

// ─── Field counts ───────────────────────────────────────────────────────────

// FieldCountForType returns the number of telemetry fields a sensor type produces.
// It mirrors sensors.FieldCount() without importing the sensors package
// (which depends on "machine"). Keep in sync with firmware/pkg/sensors/registry.go.
func FieldCountForType(t settings.SensorType) int {
	// Check driver catalog first (covers new drivers automatically).
	if d := DriverBySensorType(uint8(t)); d != nil {
		return d.FieldCount
	}
	// Fallback for legacy types not yet migrated to DriverDef.
	switch t {
	case settings.SensorFlowYFS201:
		return 2
	default:
		return 1
	}
}

// ─── Combined catalog ───────────────────────────────────────────────────────

// IOCatalog is the combined API response for both input and output interfaces.
type IOCatalog struct {
	// Input (sensor) interfaces (legacy — kept for backward compat)
	Interfaces   []InterfaceInfo   `json:"interfaces"`
	Measurements []MeasurementInfo `json:"measurements"`
	Presets      []SensorPreset    `json:"presets"`
	FieldCounts  map[uint8]int     `json:"field_counts"`
	// Output (actuator) interfaces
	OutputInterfaces []OutputInterfaceInfo `json:"output_interfaces"`
	// Driver catalog — the new authoritative driver registry
	Drivers []DriverDef `json:"drivers"`
}

// SensorCatalog is an alias for backward compatibility.
type SensorCatalog = IOCatalog

// GetCatalog returns the full IO catalog for JSON serialization.
func GetCatalog() IOCatalog {
	fc := make(map[uint8]int, int(settings.SensorTypeMax))
	for i := settings.SensorType(0); i < settings.SensorTypeMax; i++ {
		fc[uint8(i)] = FieldCountForType(i)
	}
	return IOCatalog{
		Interfaces:       Interfaces,
		Measurements:     Measurements,
		Presets:          Presets,
		FieldCounts:      fc,
		OutputInterfaces: OutputInterfaces,
		Drivers:          Drivers,
	}
}
