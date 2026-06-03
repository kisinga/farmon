// Package catalog is the single source of truth for IO interface metadata.
// It is imported by the backend and served as JSON at GET /api/farmon/io-catalog.
// The frontend fetches from that endpoint instead of maintaining its own copy.
//
// This package lives outside firmware/pkg/sensors (which imports "machine")
// so that standard Go tooling (go vet, go build) can compile it without TinyGo.
package catalog

import "github.com/kisinga/farmon/firmware/pkg/settings"

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

// IOCatalog is the combined API response for the unified driver registry.
type IOCatalog struct {
	Drivers      []DriverDef       `json:"drivers"`
	Measurements []MeasurementInfo `json:"measurements"`
	FieldCounts  map[uint8]int     `json:"field_counts"`
	Presets      []SensorPreset    `json:"presets,omitempty"`
}

// GetCatalog returns the full IO catalog for JSON serialization.
func GetCatalog() IOCatalog {
	fc := make(map[uint8]int, int(settings.SensorTypeMax))
	for i := settings.SensorType(0); i < settings.SensorTypeMax; i++ {
		fc[uint8(i)] = FieldCountForType(i)
	}
	return IOCatalog{
		Drivers:      Drivers,
		Measurements: Measurements,
		FieldCounts:  fc,
		Presets:      Presets,
	}
}
