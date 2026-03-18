package sensors

import "github.com/farmon/firmware/pkg/settings"

// DriverFactory creates a Driver from a SensorSlot and a BusRegistry.
// Returns nil if the slot configuration is invalid for this driver type.
type DriverFactory func(slot settings.SensorSlot, buses *BusRegistry) Driver

// registry is a compile-time table indexed by SensorType.
// TinyGo-safe: no reflection, no dynamic dispatch beyond a function pointer lookup.
var registry [settings.SensorTypeMax]DriverFactory

// Register associates a DriverFactory with a SensorType.
// Call once per driver type during firmware init (before initSensors).
func Register(t settings.SensorType, f DriverFactory) {
	if int(t) < len(registry) {
		registry[t] = f
	}
}

// Create looks up and calls the factory for the given slot's SensorType.
// Returns nil if no factory is registered for that type.
func Create(slot settings.SensorSlot, buses *BusRegistry) Driver {
	if int(slot.Type) < len(registry) {
		if f := registry[slot.Type]; f != nil {
			return f(slot, buses)
		}
	}
	return nil
}

// FieldCount returns how many telemetry field indices a sensor type consumes.
// Used during initSensors to detect FieldIndex collisions before they corrupt data.
func FieldCount(t settings.SensorType) int {
	switch t {
	case settings.SensorBME280:
		return 3 // temp, humidity, pressure
	case settings.SensorINA219:
		return 3 // voltage, current, power
	case settings.SensorFlowYFS201:
		return 2 // pulse delta, total volume
	case settings.SensorPulseGeneric:
		return 2 // pulse delta, total count
	default:
		return 1
	}
}
