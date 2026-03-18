package sensors

// Reading is a single sensor measurement.
type Reading struct {
	FieldIndex uint8
	Value      float32
	Valid      bool
}

// Driver is the interface all sensor drivers implement.
type Driver interface {
	Begin()
	Read() []Reading
	Name() string
}
