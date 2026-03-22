// Package boardinfo provides per-model board definitions: pin labels,
// Fritzing SVG connector IDs, and visual layout metadata.
// This is the single source of truth — both the backend API and
// firmware pin tables derive from these definitions.
package boardinfo

// PinDef describes a single user-accessible pin on a board.
type PinDef struct {
	FirmwareIdx int    `json:"firmware_idx"`
	GPIOLabel   string `json:"gpio_label"`
	ConnectorID string `json:"connector_id"`
	Edge        string `json:"edge"` // "top" | "bottom"
}

// InternalOutput describes an onboard peripheral that firmware can drive
// without user pin selection (e.g., onboard LED, NeoPixel).
type InternalOutput struct {
	ActuatorType uint8  `json:"actuator_type"` // matches settings.ActuatorType
	Label        string `json:"label"`
	GPIONum      int    `json:"gpio_num"` // actual hardware GPIO number (not firmware index)
}

// BusDef describes a default bus pin configuration for a board.
// PinIndices are firmware pin map indices (not raw GPIO numbers).
// PinFunctions are the settings.PinFunction values for each pin.
type BusDef struct {
	PinIndices   []int `json:"pin_indices"`   // e.g. [4, 5] for firmware indices
	PinFunctions []int `json:"pin_functions"` // e.g. [5, 6] for PinI2CSDA, PinI2CSCL
}

// BoardInfo describes a hardware board's visual and pin layout.
type BoardInfo struct {
	Model           string           `json:"model"`
	Label           string           `json:"label"`
	SvgUrl          string           `json:"svg_url"`
	RotateDeg       int              `json:"rotate_deg,omitempty"`
	Pins            []PinDef         `json:"pins"`
	InternalOutputs []InternalOutput `json:"internal_outputs,omitempty"`
	DefaultBuses    []BusDef         `json:"default_buses,omitempty"`
}

var registry = map[string]*BoardInfo{}

func register(b *BoardInfo) {
	registry[b.Model] = b
}

// ForModel returns the board info for the given hardware model, or nil.
func ForModel(model string) *BoardInfo {
	return registry[model]
}

// All returns all registered board definitions.
func All() []*BoardInfo {
	out := make([]*BoardInfo, 0, len(registry))
	for _, b := range registry {
		out = append(out, b)
	}
	return out
}
