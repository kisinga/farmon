package main

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/lorawan"
)

// pocketbaseLorawanStore implements lorawan.DeviceKeysProvider and lorawan.SessionStore using PocketBase.
type pocketbaseLorawanStore struct {
	app core.App
}

func newPocketbaseLorawanStore(app core.App) *pocketbaseLorawanStore {
	return &pocketbaseLorawanStore{app: app}
}

// AppKey returns the device's AppKey (16 bytes) from the devices collection.
func (s *pocketbaseLorawanStore) AppKey(devEUI string) ([16]byte, error) {
	var out [16]byte
	devEUI = normalizeEui(devEUI)
	rec, err := s.app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return out, err
	}
	keyHex, _ := rec.Get("app_key").(string)
	keyHex = strings.TrimSpace(strings.TrimPrefix(keyHex, "0x"))
	if len(keyHex) != 32 {
		return out, fmt.Errorf("device %s has no valid app_key (got %d hex chars); provision via POST /api/devices with device_eui=%s", devEUI, len(keyHex), devEUI)
	}
	b, err := hex.DecodeString(keyHex)
	if err != nil {
		return out, err
	}
	if len(b) != 16 {
		return out, fmt.Errorf("app_key decode length %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

// GetByDevEUI returns the session for the device.
func (s *pocketbaseLorawanStore) GetByDevEUI(devEUI string) (*lorawan.Session, error) {
	devEUI = normalizeEui(devEUI)
	rec, err := s.app.FindFirstRecordByFilter("lorawan_sessions", "device_eui = {:eui}", dbx.Params{"eui": devEUI})
	if err != nil {
		return nil, err
	}
	return recordToSession(rec)
}

// GetByDevAddr returns the session for the given DevAddr (4 bytes, hex lookup).
func (s *pocketbaseLorawanStore) GetByDevAddr(devAddr [4]byte) (*lorawan.Session, error) {
	hexStr := hex.EncodeToString(devAddr[:])
	rec, err := s.app.FindFirstRecordByFilter("lorawan_sessions", "dev_addr_hex = {:addr}", dbx.Params{"addr": hexStr})
	if err != nil {
		return nil, err
	}
	return recordToSession(rec)
}

// Save persists the session (upsert by device_eui).
func (s *pocketbaseLorawanStore) Save(sess *lorawan.Session) error {
	coll, err := s.app.FindCollectionByNameOrId("lorawan_sessions")
	if err != nil {
		return err
	}
	devAddrHex := hex.EncodeToString(sess.DevAddr[:])
	nwkHex := hex.EncodeToString(sess.NwkSKey[:])
	appHex := hex.EncodeToString(sess.AppSKey[:])
	existing, err := s.app.FindFirstRecordByFilter("lorawan_sessions", "device_eui = {:eui}", dbx.Params{"eui": sess.DevEUI})
	if err != nil {
		rec := core.NewRecord(coll)
		rec.Set("device_eui", sess.DevEUI)
		rec.Set("dev_addr_hex", devAddrHex)
		rec.Set("nwk_skey_hex", nwkHex)
		rec.Set("app_skey_hex", appHex)
		rec.Set("f_cnt_up", sess.FCntUp)
		rec.Set("f_cnt_down", sess.FCntDown)
		return s.app.Save(rec)
	}
	existing.Set("dev_addr_hex", devAddrHex)
	existing.Set("nwk_skey_hex", nwkHex)
	existing.Set("app_skey_hex", appHex)
	existing.Set("f_cnt_up", sess.FCntUp)
	existing.Set("f_cnt_down", sess.FCntDown)
	return s.app.Save(existing)
}

func recordToSession(rec *core.Record) (*lorawan.Session, error) {
	sess := &lorawan.Session{}
	sess.DevEUI, _ = rec.Get("device_eui").(string)
	devAddrHex, _ := rec.Get("dev_addr_hex").(string)
	nwkHex, _ := rec.Get("nwk_skey_hex").(string)
	appHex, _ := rec.Get("app_skey_hex").(string)
	if devAddrHex == "" || nwkHex == "" || appHex == "" {
		return nil, fmt.Errorf("lorawan_sessions missing keys")
	}
	devAddrB, err := hex.DecodeString(devAddrHex)
	if err != nil || len(devAddrB) != 4 {
		return nil, fmt.Errorf("dev_addr_hex invalid")
	}
	copy(sess.DevAddr[:], devAddrB)
	nwkB, err := hex.DecodeString(nwkHex)
	if err != nil || len(nwkB) != 16 {
		return nil, fmt.Errorf("nwk_skey_hex invalid")
	}
	copy(sess.NwkSKey[:], nwkB)
	appB, err := hex.DecodeString(appHex)
	if err != nil || len(appB) != 16 {
		return nil, fmt.Errorf("app_skey_hex invalid")
	}
	copy(sess.AppSKey[:], appB)
	if v, ok := rec.Get("f_cnt_up").(float64); ok {
		sess.FCntUp = uint32(v)
	}
	if v, ok := rec.Get("f_cnt_down").(float64); ok {
		sess.FCntDown = uint32(v)
	}
	if v, ok := rec.Get("f_cnt_up").(int); ok {
		sess.FCntUp = uint32(v)
	}
	if v, ok := rec.Get("f_cnt_down").(int); ok {
		sess.FCntDown = uint32(v)
	}
	// PocketBase may return numbers as int
	if v, ok := rec.Get("f_cnt_up").(int64); ok {
		sess.FCntUp = uint32(v)
	}
	if v, ok := rec.Get("f_cnt_down").(int64); ok {
		sess.FCntDown = uint32(v)
	}
	// Try string (JSON number)
	if v, ok := rec.Get("f_cnt_up").(string); ok {
		n, _ := strconv.ParseUint(v, 10, 32)
		sess.FCntUp = uint32(n)
	}
	if v, ok := rec.Get("f_cnt_down").(string); ok {
		n, _ := strconv.ParseUint(v, 10, 32)
		sess.FCntDown = uint32(n)
	}
	return sess, nil
}

// Ensure we implement the interfaces.
var (
	_ lorawan.DeviceKeysProvider = (*pocketbaseLorawanStore)(nil)
	_ lorawan.SessionStore       = (*pocketbaseLorawanStore)(nil)
)
