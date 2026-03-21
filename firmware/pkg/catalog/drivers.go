// Package catalog — driver definitions.
// This file defines the master driver registry, extending the IO catalog
// with per-driver metadata for all supported TinyGo and custom drivers.
package catalog

import "github.com/kisinga/farmon/firmware/pkg/settings"

// IOType classifies the physical bus/interface a driver uses.
type IOType string

const (
	IOTypeI2C     IOType = "i2c"
	IOTypeSPI     IOType = "spi"
	IOTypeGPIO    IOType = "gpio"
	IOTypeADC     IOType = "adc"
	IOTypeOneWire IOType = "onewire"
	IOTypeUART    IOType = "uart"
	IOTypePulse   IOType = "pulse"
)

// DriverStatus indicates whether a driver has a working adapter.
type DriverStatus string

const (
	DriverReady    DriverStatus = "ready"    // fully wrapped, adapter exists
	DriverDeferred DriverStatus = "deferred" // listed in catalog, no adapter yet
)

// DriverField describes one telemetry field produced by a driver.
type DriverField struct {
	MeasurementID string  `json:"measurement_id"`
	Label         string  `json:"label"`
	Unit          string  `json:"unit"`
	DefaultMin    float64 `json:"default_min"`
	DefaultMax    float64 `json:"default_max"`
}

// DriverDef is the master definition for a sensor/input driver.
type DriverDef struct {
	ID               string        `json:"id"`
	Label            string        `json:"label"`
	Description      string        `json:"description"`
	IOType           IOType        `json:"io_type"`
	TinyGoPackage    string        `json:"tinygo_package,omitempty"`
	CustomDriver     bool          `json:"custom_driver"`
	SensorType       uint8         `json:"sensor_type"`
	FieldCount       int           `json:"field_count"`
	Fields           []DriverField `json:"fields"`
	DefaultI2CAddr   uint8         `json:"default_i2c_addr,omitempty"`
	NeedsCalib       bool          `json:"needs_calib"`
	PinCount         int           `json:"pin_count"`
	PinFunctions     []uint8       `json:"pin_functions,omitempty"`
	BusPinFunctions  []uint8       `json:"bus_pin_functions,omitempty"`
	BusAddressed     bool          `json:"bus_addressed"`
	SubTypes         []string      `json:"sub_types,omitempty"`
	SupportedTargets []string      `json:"supported_targets"` // e.g. ["rp2040","lorae5"]
	Status           DriverStatus  `json:"status"`
}

// allTargets is the default for drivers that work on all hardware.
var allTargets = []string{"rp2040", "lorae5"}

// rp2040Only is for drivers that require RP2040-specific hardware (e.g. ADC).
var rp2040Only = []string{"rp2040"}

// i2cBusPins is the standard bus pin set for I2C drivers.
var i2cBusPins = []uint8{uint8(settings.PinI2CSDA), uint8(settings.PinI2CSCL)}

// uartBusPins is the standard bus pin set for UART drivers.
var uartBusPins = []uint8{uint8(settings.PinUARTTX), uint8(settings.PinUARTRX)}

// Drivers is the authoritative list of all sensor/input drivers.
var Drivers = []DriverDef{
	// ──────────────────────────────────────────────────────────
	// Ready — custom drivers (existing firmware/pkg/sensors/ implementations)
	// ──────────────────────────────────────────────────────────
	{
		ID: "adc_linear", Label: "Analog (0-VREF Linear)", Description: "Any linear 0-VREF analog sensor with offset/span calibration",
		IOType: IOTypeADC, CustomDriver: true, SensorType: uint8(settings.SensorADCLinear),
		FieldCount: 1, Fields: []DriverField{{MeasurementID: "custom", Label: "Value", Unit: "", DefaultMin: 0, DefaultMax: 100}},
		NeedsCalib: true, PinCount: 1, PinFunctions: []uint8{uint8(settings.PinADC)},
		SupportedTargets: rp2040Only, Status: DriverReady,
	},
	{
		ID: "adc_4_20ma", Label: "Analog (4-20mA Loop)", Description: "4-20mA current loop with 250Ω shunt resistor",
		IOType: IOTypeADC, CustomDriver: true, SensorType: uint8(settings.SensorADC4_20mA),
		FieldCount: 1, Fields: []DriverField{{MeasurementID: "custom", Label: "Value", Unit: "", DefaultMin: 0, DefaultMax: 100}},
		NeedsCalib: true, PinCount: 1, PinFunctions: []uint8{uint8(settings.PinADC)},
		SupportedTargets: rp2040Only, Status: DriverReady,
	},
	{
		ID: "ds18b20", Label: "DS18B20 (1-Wire)", Description: "Waterproof digital temperature sensor, -55 to 125°C",
		IOType: IOTypeOneWire, CustomDriver: true, SensorType: uint8(settings.SensorDS18B20),
		FieldCount: 1, Fields: []DriverField{{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -55, DefaultMax: 125}},
		PinCount: 1, PinFunctions: []uint8{uint8(settings.PinOneWire)},
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "digital_in", Label: "Digital Input (GPIO)", Description: "GPIO digital input with configurable pull-up/pull-down",
		IOType: IOTypeGPIO, CustomDriver: true, SensorType: uint8(settings.SensorDigitalIn),
		FieldCount: 1, Fields: []DriverField{{MeasurementID: "state", Label: "State", Unit: "", DefaultMin: 0, DefaultMax: 1}},
		PinCount: 1, PinFunctions: []uint8{uint8(settings.PinButton)},
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "pulse_generic", Label: "Pulse Counter", Description: "Generic pulse counter with configurable pulses-per-unit",
		IOType: IOTypePulse, CustomDriver: true, SensorType: uint8(settings.SensorPulseGeneric),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "flow_rate", Label: "Rate", Unit: "/min", DefaultMin: 0, DefaultMax: 100},
			{MeasurementID: "volume", Label: "Total", Unit: "", DefaultMin: 0, DefaultMax: 10000},
		},
		PinCount: 1, PinFunctions: []uint8{uint8(settings.PinCounter)},
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "modbus_rtu", Label: "Modbus RTU (RS-485)", Description: "Modbus RTU register read over RS-485 UART bus",
		IOType: IOTypeUART, CustomDriver: true, SensorType: uint8(settings.SensorModbusRTU),
		FieldCount: 1, Fields: []DriverField{{MeasurementID: "custom", Label: "Register Value", Unit: "", DefaultMin: 0, DefaultMax: 65535}},
		BusAddressed: true, BusPinFunctions: uartBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},

	// ──────────────────────────────────────────────────────────
	// Ready — I2C drivers (existing custom, will migrate to TinyGo wrappers)
	// ──────────────────────────────────────────────────────────
	{
		ID: "bme280", Label: "BME280", Description: "Bosch environmental sensor: temperature, humidity, and pressure",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bme280",
		CustomDriver: true, SensorType: uint8(settings.SensorBME280),
		FieldCount: 3, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 85},
			{MeasurementID: "humidity", Label: "Humidity", Unit: "%RH", DefaultMin: 0, DefaultMax: 100},
			{MeasurementID: "pressure", Label: "Pressure", Unit: "hPa", DefaultMin: 300, DefaultMax: 1100},
		},
		DefaultI2CAddr: 0x76, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "ina219", Label: "INA219", Description: "TI high-side current/voltage/power monitor",
		IOType: IOTypeI2C,
		CustomDriver: true, SensorType: uint8(settings.SensorINA219),
		FieldCount: 3, Fields: []DriverField{
			{MeasurementID: "voltage", Label: "Voltage", Unit: "V", DefaultMin: 0, DefaultMax: 26},
			{MeasurementID: "current", Label: "Current", Unit: "A", DefaultMin: 0, DefaultMax: 3.2},
			{MeasurementID: "power", Label: "Power", Unit: "W", DefaultMin: 0, DefaultMax: 83},
		},
		DefaultI2CAddr: 0x40, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},

	// ──────────────────────────────────────────────────────────
	// Ready — new I2C drivers (TinyGo wrappers)
	// ──────────────────────────────────────────────────────────
	{
		ID: "sht3x", Label: "SHT3x", Description: "Sensirion humidity and temperature sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/sht3x",
		SensorType: uint8(settings.SensorSHT3x),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 125},
			{MeasurementID: "humidity", Label: "Humidity", Unit: "%RH", DefaultMin: 0, DefaultMax: 100},
		},
		DefaultI2CAddr: 0x44, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "sht4x", Label: "SHT4x", Description: "Sensirion 4th-gen humidity and temperature sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/sht4x",
		SensorType: uint8(settings.SensorSHT4x),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 125},
			{MeasurementID: "humidity", Label: "Humidity", Unit: "%RH", DefaultMin: 0, DefaultMax: 100},
		},
		DefaultI2CAddr: 0x44, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "bmp280", Label: "BMP280", Description: "Bosch temperature and pressure sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bmp280",
		SensorType: uint8(settings.SensorBMP280),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 85},
			{MeasurementID: "pressure", Label: "Pressure", Unit: "hPa", DefaultMin: 300, DefaultMax: 1100},
		},
		DefaultI2CAddr: 0x76, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "bmp388", Label: "BMP388", Description: "Bosch high-precision pressure sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bmp388",
		SensorType: uint8(settings.SensorBMP388),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 85},
			{MeasurementID: "pressure", Label: "Pressure", Unit: "hPa", DefaultMin: 300, DefaultMax: 1250},
		},
		DefaultI2CAddr: 0x76, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "bh1750", Label: "BH1750", Description: "Ambient light intensity sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bh1750",
		SensorType: uint8(settings.SensorBH1750),
		FieldCount: 1, Fields: []DriverField{
			{MeasurementID: "custom", Label: "Illuminance", Unit: "lx", DefaultMin: 0, DefaultMax: 65535},
		},
		DefaultI2CAddr: 0x23, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "aht20", Label: "AHT20", Description: "ASAIR temperature and humidity sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/aht20",
		SensorType: uint8(settings.SensorAHT20),
		FieldCount: 2, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 85},
			{MeasurementID: "humidity", Label: "Humidity", Unit: "%RH", DefaultMin: 0, DefaultMax: 100},
		},
		DefaultI2CAddr: 0x38, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "tmp102", Label: "TMP102", Description: "TI low-power digital temperature sensor",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/tmp102",
		SensorType: uint8(settings.SensorTMP102),
		FieldCount: 1, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 125},
		},
		DefaultI2CAddr: 0x48, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "mcp9808", Label: "MCP9808", Description: "Microchip high-accuracy temperature sensor (±0.25°C)",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/mcp9808",
		SensorType: uint8(settings.SensorMCP9808),
		FieldCount: 1, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -40, DefaultMax: 125},
		},
		DefaultI2CAddr: 0x18, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "ina260", Label: "INA260", Description: "TI precision current/voltage/power monitor with integrated shunt",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/ina260",
		SensorType: uint8(settings.SensorINA260),
		FieldCount: 3, Fields: []DriverField{
			{MeasurementID: "voltage", Label: "Voltage", Unit: "V", DefaultMin: 0, DefaultMax: 36},
			{MeasurementID: "current", Label: "Current", Unit: "A", DefaultMin: 0, DefaultMax: 15},
			{MeasurementID: "power", Label: "Power", Unit: "W", DefaultMin: 0, DefaultMax: 540},
		},
		DefaultI2CAddr: 0x40, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},
	{
		ID: "adt7410", Label: "ADT7410", Description: "Analog Devices high-accuracy temperature sensor (±0.5°C)",
		IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/adt7410",
		SensorType: uint8(settings.SensorADT7410),
		FieldCount: 1, Fields: []DriverField{
			{MeasurementID: "temperature", Label: "Temperature", Unit: "°C", DefaultMin: -55, DefaultMax: 150},
		},
		DefaultI2CAddr: 0x48, BusAddressed: true, BusPinFunctions: i2cBusPins,
		SupportedTargets: allTargets, Status: DriverReady,
	},

	// ──────────────────────────────────────────────────────────
	// Deferred — I2C sensors (listed, no adapter yet)
	// ──────────────────────────────────────────────────────────
	{ID: "bmp180", Label: "BMP180", Description: "Bosch barometric pressure sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bmp180", FieldCount: 2, DefaultI2CAddr: 0x77, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "hts221", Label: "HTS221", Description: "ST humidity and temperature sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/hts221", FieldCount: 2, DefaultI2CAddr: 0x5F, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "ens160", Label: "ENS160", Description: "ScioSense air quality sensor (eCO2/TVOC)", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/ens160", FieldCount: 2, DefaultI2CAddr: 0x53, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "sgp30", Label: "SGP30", Description: "Sensirion gas sensor (eCO2/TVOC)", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/sgp30", FieldCount: 2, DefaultI2CAddr: 0x58, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "scd4x", Label: "SCD4x", Description: "Sensirion CO2 sensor (true NDIR)", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/scd4x", FieldCount: 3, DefaultI2CAddr: 0x62, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "shtc3", Label: "SHTC3", Description: "Sensirion humidity and temperature sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/shtc3", FieldCount: 2, DefaultI2CAddr: 0x70, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "lps22hb", Label: "LPS22HB", Description: "ST nano pressure sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/lps22hb", FieldCount: 2, DefaultI2CAddr: 0x5C, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "veml6070", Label: "VEML6070", Description: "Vishay UV light sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/veml6070", FieldCount: 1, DefaultI2CAddr: 0x38, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "apds9960", Label: "APDS9960", Description: "Broadcom proximity, light, RGB, and gesture sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/apds9960", FieldCount: 1, DefaultI2CAddr: 0x39, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},

	// Deferred — I2C IMU / motion sensors
	{ID: "mpu6050", Label: "MPU6050", Description: "InvenSense 6-axis accelerometer and gyroscope", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/mpu6050", FieldCount: 6, DefaultI2CAddr: 0x68, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "mpu6886", Label: "MPU6886", Description: "InvenSense 6-axis accelerometer and gyroscope", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/mpu6886", FieldCount: 6, DefaultI2CAddr: 0x68, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "lsm6ds3", Label: "LSM6DS3", Description: "ST 6-axis accelerometer and gyroscope", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/lsm6ds3", FieldCount: 6, DefaultI2CAddr: 0x6A, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "lsm9ds1", Label: "LSM9DS1", Description: "ST 9-axis IMU (accel/gyro/mag)", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/lsm9ds1", FieldCount: 9, DefaultI2CAddr: 0x6A, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "lis3dh", Label: "LIS3DH", Description: "ST 3-axis accelerometer", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/lis3dh", FieldCount: 3, DefaultI2CAddr: 0x18, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "bma42x", Label: "BMA42x", Description: "Bosch 3-axis accelerometer", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/bma42x", FieldCount: 3, DefaultI2CAddr: 0x18, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "amg88xx", Label: "AMG88xx", Description: "Panasonic 8x8 thermal camera", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/amg88xx", FieldCount: 1, DefaultI2CAddr: 0x69, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},

	// Deferred — I2C distance sensors
	{ID: "vl53l1x", Label: "VL53L1X", Description: "ST time-of-flight distance sensor (up to 4m)", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/vl53l1x", FieldCount: 1, DefaultI2CAddr: 0x29, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "vl6180x", Label: "VL6180X", Description: "ST proximity and ambient light sensor", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/vl6180x", FieldCount: 2, DefaultI2CAddr: 0x29, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},

	// Deferred — I2C RTC modules
	{ID: "ds1307", Label: "DS1307", Description: "Maxim real-time clock", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/ds1307", FieldCount: 1, DefaultI2CAddr: 0x68, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "ds3231", Label: "DS3231", Description: "Maxim precision RTC with temperature compensation", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/ds3231", FieldCount: 2, DefaultI2CAddr: 0x68, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "pcf8523", Label: "PCF8523", Description: "NXP low-power real-time clock", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/pcf8523", FieldCount: 1, DefaultI2CAddr: 0x68, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "pcf8563", Label: "PCF8563", Description: "NXP real-time clock/calendar", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/pcf8563", FieldCount: 1, DefaultI2CAddr: 0x51, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},

	// Deferred — I2C power/expansion
	{ID: "pca9685", Label: "PCA9685", Description: "NXP 16-channel 12-bit PWM/servo driver", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/pca9685", FieldCount: 0, DefaultI2CAddr: 0x40, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "mcp23017", Label: "MCP23017", Description: "Microchip 16-bit I/O expander", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/mcp23017", FieldCount: 0, DefaultI2CAddr: 0x20, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "pcf8591", Label: "PCF8591", Description: "NXP 8-bit ADC/DAC", IOType: IOTypeI2C, TinyGoPackage: "tinygo.org/x/drivers/pcf8591", FieldCount: 4, DefaultI2CAddr: 0x48, BusAddressed: true, BusPinFunctions: i2cBusPins, SupportedTargets: allTargets, Status: DriverDeferred},

	// ──────────────────────────────────────────────────────────
	// Deferred — SPI sensors
	// ──────────────────────────────────────────────────────────
	{ID: "bmi160", Label: "BMI160", Description: "Bosch 6-axis IMU (SPI)", IOType: IOTypeSPI, TinyGoPackage: "tinygo.org/x/drivers/bmi160", FieldCount: 6, BusAddressed: true, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "max6675", Label: "MAX6675", Description: "Maxim thermocouple-to-digital converter (SPI)", IOType: IOTypeSPI, TinyGoPackage: "tinygo.org/x/drivers/max6675", FieldCount: 1, BusAddressed: true, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "mcp3008", Label: "MCP3008", Description: "Microchip 8-channel 10-bit ADC (SPI)", IOType: IOTypeSPI, TinyGoPackage: "tinygo.org/x/drivers/mcp3008", FieldCount: 1, BusAddressed: true, SupportedTargets: allTargets, Status: DriverDeferred},

	// ──────────────────────────────────────────────────────────
	// Deferred — GPIO sensors
	// ──────────────────────────────────────────────────────────
	{ID: "dhtxx", Label: "DHT11/DHT22", Description: "Single-wire temperature and humidity sensor", IOType: IOTypeGPIO, TinyGoPackage: "tinygo.org/x/drivers/dht", FieldCount: 2, PinCount: 1, PinFunctions: []uint8{uint8(settings.PinButton)}, SupportedTargets: allTargets, Status: DriverDeferred},
	{ID: "hcsr04", Label: "HC-SR04", Description: "Ultrasonic distance sensor (2-400cm)", IOType: IOTypeGPIO, TinyGoPackage: "tinygo.org/x/drivers/hcsr04", FieldCount: 1, PinCount: 2, SupportedTargets: allTargets, Status: DriverDeferred},
}

// DriverByID returns the DriverDef with the given ID, or nil if not found.
func DriverByID(id string) *DriverDef {
	for i := range Drivers {
		if Drivers[i].ID == id {
			return &Drivers[i]
		}
	}
	return nil
}

// DriverBySensorType returns the DriverDef with the given SensorType, or nil.
func DriverBySensorType(st uint8) *DriverDef {
	for i := range Drivers {
		if Drivers[i].SensorType == st && Drivers[i].Status == DriverReady {
			return &Drivers[i]
		}
	}
	return nil
}

// ReadyDrivers returns only drivers with Status == DriverReady.
func ReadyDrivers() []DriverDef {
	var out []DriverDef
	for _, d := range Drivers {
		if d.Status == DriverReady {
			out = append(out, d)
		}
	}
	return out
}

// DriversByIOType returns drivers filtered by IO type.
func DriversByIOType(ioType IOType) []DriverDef {
	var out []DriverDef
	for _, d := range Drivers {
		if d.IOType == ioType {
			out = append(out, d)
		}
	}
	return out
}

// DriversForTarget returns only drivers that support the given hardware model.
func DriversForTarget(target string) []DriverDef {
	var out []DriverDef
	for _, d := range Drivers {
		if d.SupportsTarget(target) {
			out = append(out, d)
		}
	}
	return out
}

// SupportsTarget returns true if this driver supports the given hardware model.
func (d *DriverDef) SupportsTarget(target string) bool {
	if len(d.SupportedTargets) == 0 {
		return true // no restriction = all targets
	}
	for _, t := range d.SupportedTargets {
		if t == target {
			return true
		}
	}
	return false
}
