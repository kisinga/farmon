package main

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

// LoadGatewaySettings returns the single gateway_settings record as Config and whether it is valid.
// If no record exists, returns DefaultGatewayConfig() and false.
func LoadGatewaySettings(app core.App) (gateway.Config, bool) {
	records, err := app.FindRecordsByFilter("gateway_settings", "", "created", 1, 0, nil)
	if err != nil || len(records) == 0 {
		return gateway.DefaultGatewayConfig(), false
	}
	cfg := recordToGatewayConfig(records[0])
	return cfg, cfg.Valid()
}

// SaveGatewaySettings upserts the single gateway_settings record from cfg. Caller must validate cfg.Valid() first.
func SaveGatewaySettings(app core.App, cfg gateway.Config) error {
	coll, err := app.FindCollectionByNameOrId("gateway_settings")
	if err != nil || coll == nil {
		return err
	}
	rec, err := getGatewaySettingsRecord(app)
	var toSave *core.Record
	if err != nil || rec == nil {
		toSave = core.NewRecord(coll)
	} else {
		toSave = rec
	}
	configToRecord(toSave, cfg)
	return app.Save(toSave)
}

func getGatewaySettingsRecord(app core.App) (*core.Record, error) {
	records, err := app.FindRecordsByFilter("gateway_settings", "", "created", 1, 0, nil)
	if err != nil || len(records) == 0 {
		return nil, err
	}
	return records[0], nil
}

func getRecordString(rec *core.Record, field string) string {
	if rec == nil {
		return ""
	}
	v := rec.Get(field)
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func numberFromRecord(rec *core.Record, field string) int {
	if rec == nil {
		return 0
	}
	v := rec.Get(field)
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

func recordToGatewayConfig(rec *core.Record) gateway.Config {
	cfg := gateway.DefaultGatewayConfig()
	cfg.EventURL = getRecordString(rec, "event_url")
	cfg.CommandURL = getRecordString(rec, "command_url")
	cfg.GatewayID = getRecordString(rec, "gateway_id")
	if r := getRecordString(rec, "region"); r != "" {
		cfg.Region = strings.ToUpper(r)
	}
	if n := numberFromRecord(rec, "rx1_delay"); n >= gateway.MinRX1DelaySec() && n <= gateway.MaxRX1DelaySec() {
		cfg.RX1DelaySec = n
	}
	if n := numberFromRecord(rec, "rx1_frequency_hz"); n > 0 {
		cfg.RX1FrequencyHz = uint32(n)
	}
	if v := rec.Get("manage_concentratord"); v != nil {
		if b, ok := v.(bool); ok {
			cfg.ManageConcentratord = b
		}
	}
	return cfg
}

func configToRecord(rec *core.Record, cfg gateway.Config) {
	rec.Set("region", cfg.Region)
	rec.Set("event_url", cfg.EventURL)
	rec.Set("command_url", cfg.CommandURL)
	rec.Set("gateway_id", cfg.GatewayID)
	rec.Set("rx1_delay", cfg.RX1DelaySec)
	rec.Set("rx1_frequency_hz", cfg.RX1FrequencyHz)
	rec.Set("manage_concentratord", cfg.ManageConcentratord)
}
