// Package auth handles device credential generation and verification.
package auth

import (
	"crypto/rand"
	"encoding/hex"

	"golang.org/x/crypto/bcrypt"
)

// GenerateToken returns a new random device token (hex-encoded 32 bytes). The
// raw token is shown to the device once at provisioning; only its hash is
// stored.
func GenerateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashToken returns a bcrypt hash of the raw token for storage.
func HashToken(raw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(raw), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// VerifyToken reports whether raw matches the stored bcrypt hash.
func VerifyToken(hash, raw string) bool {
	if hash == "" || raw == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(raw)) == nil
}
