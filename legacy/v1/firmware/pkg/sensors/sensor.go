// Package sensors provides runtime-configurable sensor drivers for the AirConfig
// firmware platform. Each driver implements the Driver interface and is registered
// at startup via Register(). The registry is indexed by SensorType so the node
// can instantiate drivers from persisted SensorSlot flash config with no reflection.
//
// Shared infrastructure:
//   - driver.go      — Reading, Driver interface
//   - registry.go    — Register / Create / FieldCount
//   - pulse_base.go  — volatile32, pulseCounter (shared by flow + pulse_generic)
//   - onewire.go     — 1-Wire bit-bang helpers (shared by ds18b20)
//   - adc_calib.go   — decodeCalibParams (shared by adc_linear + adc_4_20ma)
//
// Drivers (one file each):
//   battery.go, ds18b20.go, soil.go, bme280.go, ina219.go,
//   adc_linear.go, adc_4_20ma.go, flow.go, pulse_generic.go, digital_in.go
package sensors
