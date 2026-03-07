package lorawan

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"log"

	"github.com/brocaar/lorawan"
)

// DefaultNetID is used for JoinAccept when no custom NetID is configured (LoRaWAN 1.0).
var DefaultNetID = lorawan.NetID{0, 0, 1}

// UplinkResult is the result of processing an uplink PHY payload.
type UplinkResult struct {
	// DevEUI (hex) and Decrypted payload; set for data uplinks.
	DevEUI  string
	FPort   uint8
	Payload []byte
	// JoinAcceptPHY is set when the uplink was a valid JoinRequest; caller must send this as downlink.
	JoinAcceptPHY []byte
}

// ProcessUplinkOptions are optional options for ProcessUplink (e.g. JoinAccept RXDelay).
type ProcessUplinkOptions struct {
	// RXDelay is the JoinAccept RXDelay (1–15 seconds). If 0, default 1 is used.
	RXDelay uint8
}

// ProcessUplink decodes the PHY payload. For JoinRequest: validates MIC, creates session, returns JoinAcceptPHY.
// For data: finds session by DevAddr, validates MIC, decrypts, returns DevEUI, FPort, Payload.
// opts may be nil; RXDelay in opts is used for JoinAccept and must match gateway scheduling.
func ProcessUplink(phyRaw []byte, keys DeviceKeysProvider, sessions SessionStore, opts *ProcessUplinkOptions) (*UplinkResult, error) {
	var phy lorawan.PHYPayload
	if err := phy.UnmarshalBinary(phyRaw); err != nil {
		return nil, fmt.Errorf("phy unmarshal: %w", err)
	}

	switch phy.MHDR.MType {
	case lorawan.JoinRequest:
		return processJoinRequest(&phy, keys, sessions, opts)
	case lorawan.UnconfirmedDataUp, lorawan.ConfirmedDataUp:
		return processDataUp(&phy, sessions)
	default:
		return nil, fmt.Errorf("unsupported mtype: %s", phy.MHDR.MType)
	}
}

func processJoinRequest(phy *lorawan.PHYPayload, keys DeviceKeysProvider, sessions SessionStore, opts *ProcessUplinkOptions) (*UplinkResult, error) {
	jr, ok := phy.MACPayload.(*lorawan.JoinRequestPayload)
	if !ok {
		return nil, errors.New("invalid join request payload")
	}
	devEUI := jr.DevEUI.String()
	appKeySlice, err := keys.AppKey(devEUI)
	if err != nil {
		return nil, fmt.Errorf("app key: %w", err)
	}
	var appKey lorawan.AES128Key
	copy(appKey[:], appKeySlice[:])
	ok, err = phy.ValidateUplinkJoinMIC(appKey)
	if err != nil || !ok {
		return nil, fmt.Errorf("join MIC invalid: %w", err)
	}

	// Allocate new session: JoinNonce (we choose), DevAddr (we choose), derive keys.
	joinNonce, err := newJoinNonce()
	if err != nil {
		return nil, err
	}
	devAddr := allocDevAddr()
	nwkSKey, appSKey, err := DeriveSessionKeys(appKey, joinNonce, jr.DevNonce, DefaultNetID, devAddr)
	if err != nil {
		return nil, err
	}
	s := &Session{
		DevEUI:   devEUI,
		DevAddr:  devAddr,
		NwkSKey:  nwkSKey,
		AppSKey:  appSKey,
		FCntUp:   0,
		FCntDown: 0,
	}
	if err := sessions.Save(s); err != nil {
		return nil, fmt.Errorf("save session: %w", err)
	}

	rxDelay := uint8(1)
	if opts != nil && opts.RXDelay >= 1 && opts.RXDelay <= 15 {
		rxDelay = opts.RXDelay
	}
	// Build JoinAccept PHY.
	ja := &lorawan.PHYPayload{
		MHDR: lorawan.MHDR{MType: lorawan.JoinAccept, Major: lorawan.LoRaWANR1},
		MACPayload: &lorawan.JoinAcceptPayload{
			JoinNonce:  joinNonce,
			HomeNetID:  DefaultNetID,
			DevAddr:    devAddr,
			DLSettings: lorawan.DLSettings{RX2DataRate: 0, RX1DROffset: 0},
			RXDelay:    rxDelay,
		},
	}
	if err := ja.SetDownlinkJoinMIC(lorawan.JoinRequestType, jr.JoinEUI, jr.DevNonce, appKey); err != nil {
		return nil, err
	}
	if err := ja.EncryptJoinAcceptPayload(appKey); err != nil {
		return nil, err
	}
	jaBytes, err := ja.MarshalBinary()
	if err != nil {
		return nil, err
	}
	return &UplinkResult{JoinAcceptPHY: jaBytes}, nil
}

func processDataUp(phy *lorawan.PHYPayload, sessions SessionStore) (*UplinkResult, error) {
	mac, ok := phy.MACPayload.(*lorawan.MACPayload)
	if !ok {
		return nil, errors.New("invalid data payload")
	}
	devAddr := mac.FHDR.DevAddr
	var devAddrArr [4]byte
	copy(devAddrArr[:], devAddr[:])
	s, err := sessions.GetByDevAddr(devAddrArr)
	if err != nil {
		return nil, fmt.Errorf("session: %w", err)
	}
	// LoRaWAN 1.0: MIC is computed with NwkSKey; FCnt is 16-bit in FHDR, use full 32-bit from session for validation
	mac.FHDR.FCnt = s.FCntUp
	ok, err = phy.ValidateUplinkDataMIC(lorawan.LoRaWAN1_0, 0, 0, 0, s.NwkSKey, s.NwkSKey)
	if err != nil || !ok {
		return nil, fmt.Errorf("data MIC invalid: %w", err)
	}
	if err := phy.DecryptFRMPayload(s.AppSKey); err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}
	// Update FCntUp and persist
	s.FCntUp++
	if err := sessions.Save(s); err != nil {
		log.Printf("lorawan: save session after uplink: %v", err)
	}
	var fPort uint8
	if mac.FPort != nil {
		fPort = *mac.FPort
	}
	var payload []byte
	if len(mac.FRMPayload) > 0 {
		if dp, ok := mac.FRMPayload[0].(*lorawan.DataPayload); ok {
			payload = dp.Bytes
		}
	}
	return &UplinkResult{DevEUI: s.DevEUI, FPort: fPort, Payload: payload}, nil
}

// BuildDataDownlink builds a LoRaWAN PHY payload for a downlink data message.
func BuildDataDownlink(devEUI string, fPort uint8, payload []byte, sessions SessionStore) (phyRaw []byte, err error) {
	s, err := sessions.GetByDevEUI(devEUI)
	if err != nil {
		return nil, fmt.Errorf("session: %w", err)
	}
	s.FCntDown++
	// Build unconfirmed data down
	fPortPtr := fPort
	phy := &lorawan.PHYPayload{
		MHDR: lorawan.MHDR{MType: lorawan.UnconfirmedDataDown, Major: lorawan.LoRaWANR1},
		MACPayload: &lorawan.MACPayload{
			FHDR: lorawan.FHDR{
				DevAddr: s.DevAddr,
				FCnt:   s.FCntDown,
			},
			FPort:      &fPortPtr,
			FRMPayload: []lorawan.Payload{&lorawan.DataPayload{Bytes: payload}},
		},
	}
	if err := phy.EncryptFRMPayload(s.AppSKey); err != nil {
		return nil, err
	}
	if err := phy.SetDownlinkDataMIC(lorawan.LoRaWAN1_0, 0, s.NwkSKey); err != nil {
		return nil, err
	}
	if err := sessions.Save(s); err != nil {
		return nil, err
	}
	return phy.MarshalBinary()
}

func newJoinNonce() (lorawan.JoinNonce, error) {
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, err
	}
	return lorawan.JoinNonce(binary.LittleEndian.Uint32(append(b[:], 0))), nil
}

func allocDevAddr() lorawan.DevAddr {
	// Simple allocation: random 32-bit (high bit 0 for devaddr). In production use a proper allocator.
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		b[0] = 0
	}
	b[0] &^= 0x80
	var d lorawan.DevAddr
	copy(d[:], b[:])
	return d
}
