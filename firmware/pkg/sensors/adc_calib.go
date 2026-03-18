package sensors

// decodeCalibParams decodes the Param1/Param2 encoding shared by ADC-based sensors.
//
// Encoding:
//   param1 = physical minimum × 10, stored as int16 bit pattern in uint16.
//   param2 = physical span (max - min) × 10, stored as uint16.
//
// Returns offset and span as floats ready for: value = offset + normalized × span.
func decodeCalibParams(param1, param2 uint16) (offset, span float32) {
	return float32(int16(param1)) / 10.0, float32(param2) / 10.0
}
