package lorawan

import (
	"crypto/aes"
	"encoding/binary"

	"github.com/brocaar/lorawan"
)

// Session holds LoRaWAN 1.0 session keys and frame counters for a device.
type Session struct {
	DevEUI   string
	DevAddr  lorawan.DevAddr
	NwkSKey  lorawan.AES128Key
	AppSKey  lorawan.AES128Key
	FCntUp   uint32
	FCntDown uint32
}

// DeriveSessionKeys computes NwkSKey and AppSKey from AppKey (LoRaWAN 1.0).
// joinNonce and devNonce are from the JoinRequest; netID and devAddr are chosen by the NS.
func DeriveSessionKeys(appKey lorawan.AES128Key, joinNonce lorawan.JoinNonce, devNonce lorawan.DevNonce, netID lorawan.NetID, devAddr lorawan.DevAddr) (nwkSKey, appSKey lorawan.AES128Key, err error) {
	nwkSKey, err = deriveSKey(0x01, appKey, joinNonce, devNonce, netID)
	if err != nil {
		return lorawan.AES128Key{}, lorawan.AES128Key{}, err
	}
	appSKey, err = deriveSKey(0x02, appKey, joinNonce, devNonce, netID)
	if err != nil {
		return lorawan.AES128Key{}, lorawan.AES128Key{}, err
	}
	return nwkSKey, appSKey, nil
}

// deriveSKey implements LoRaWAN 1.0 key derivation (optNeg = false).
// typ is 0x01 for NwkSKey, 0x02 for AppSKey.
func deriveSKey(typ byte, nwkKey lorawan.AES128Key, joinNonce lorawan.JoinNonce, devNonce lorawan.DevNonce, netID lorawan.NetID) (lorawan.AES128Key, error) {
	var key lorawan.AES128Key
	b := make([]byte, 16)
	b[0] = typ
	joinNonceB, _ := joinNonce.MarshalBinary()
	netIDB, _ := netID.MarshalBinary()
	devNonceB, _ := devNonce.MarshalBinary()
	copy(b[1:4], joinNonceB)
	copy(b[4:7], netIDB)
	copy(b[7:9], devNonceB)
	block, err := aes.NewCipher(nwkKey[:])
	if err != nil {
		return key, err
	}
	block.Encrypt(key[:], b)
	return key, nil
}

// DevAddrFromUint32 returns a DevAddr from a 32-bit value (big-endian as in spec).
func DevAddrFromUint32(v uint32) lorawan.DevAddr {
	var d lorawan.DevAddr
	binary.BigEndian.PutUint32(d[:], v)
	return d
}
