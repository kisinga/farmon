package lorawan

// DeviceKeysProvider returns the AppKey (16 bytes) for a device by DevEUI (hex string).
type DeviceKeysProvider interface {
	AppKey(devEUI string) ([16]byte, error)
}

// SessionStore persists and retrieves LoRaWAN sessions.
type SessionStore interface {
	GetByDevEUI(devEUI string) (*Session, error)
	GetByDevAddr(devAddr [4]byte) (*Session, error)
	Save(s *Session) error
}
