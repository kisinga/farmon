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

// BoardInfo describes a hardware board's visual and pin layout.
type BoardInfo struct {
	Model     string   `json:"model"`
	Label     string   `json:"label"`
	SvgUrl    string   `json:"svg_url"`
	RotateDeg int      `json:"rotate_deg,omitempty"`
	Pins      []PinDef `json:"pins"`
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
