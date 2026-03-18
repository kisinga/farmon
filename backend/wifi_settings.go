package main

import (
	"log"
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// WifiConfig holds WiFi transport settings (enabled, test_mode).
type WifiConfig struct {
	Enabled  bool
	TestMode bool
}

// WifiState holds the in-memory WiFi config. Thread-safe via RWMutex.
type WifiState struct {
	cfg WifiConfig
	mu  sync.RWMutex
}

func (s *WifiState) Config() WifiConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *WifiState) SetConfig(cfg WifiConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
}

// loadWifiSettings reads the single wifi_settings record from DB.
func loadWifiSettings(app core.App) (WifiConfig, bool) {
	records, err := app.FindRecordsByFilter("wifi_settings", "", "-@rowid", 1, 0, nil)
	if err != nil || len(records) == 0 {
		return WifiConfig{Enabled: true, TestMode: false}, false
	}
	rec := records[0]
	cfg := WifiConfig{Enabled: true, TestMode: false}
	if v := rec.Get("enabled"); v != nil {
		if b, ok := v.(bool); ok {
			cfg.Enabled = b
		}
	}
	if v := rec.Get("test_mode"); v != nil {
		if b, ok := v.(bool); ok {
			cfg.TestMode = b
		}
	}
	log.Printf("wifi_settings: enabled=%t test_mode=%t", cfg.Enabled, cfg.TestMode)
	return cfg, true
}

// saveWifiSettings upserts the single wifi_settings record.
func saveWifiSettings(app core.App, cfg WifiConfig) error {
	coll, err := app.FindCollectionByNameOrId("wifi_settings")
	if err != nil || coll == nil {
		return err
	}
	records, _ := app.FindRecordsByFilter("wifi_settings", "", "-@rowid", 1, 0, nil)
	var rec *core.Record
	if len(records) > 0 {
		rec = records[0]
	} else {
		rec = core.NewRecord(coll)
	}
	rec.Set("enabled", cfg.Enabled)
	rec.Set("test_mode", cfg.TestMode)
	return app.Save(rec)
}
