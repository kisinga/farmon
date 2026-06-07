package flash

// CRC16 computes CRC-16-CCITT over data.
// Same polynomial (0x1021) and initial value (0xFFFF) as the C++ firmware,
// ensuring wire compatibility with the backend CRC verification.
func CRC16(data []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc ^= uint16(b) << 8
		for k := 0; k < 8; k++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc = crc << 1
			}
		}
	}
	return crc
}
