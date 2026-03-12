package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/codec"
	"github.com/kisinga/farmon/pi/internal/concentratord"
	"github.com/kisinga/farmon/pi/internal/gateway"
	"github.com/kisinga/farmon/pi/internal/lorawan"
)

const gatewayIDDiscoverTimeout = 5 * time.Second

// rate-limit "no app_key" log spam (same device every 5 min)
var (
	appKeyErrLastLog   = map[string]time.Time{}
	appKeyErrLastLogMu sync.Mutex
)

func shouldLogAppKeyErr(errMsg string) bool {
	if !strings.Contains(errMsg, "has no valid app_key") {
		return true
	}
	// Extract "device X" for rate-limit key (EUI is in the message)
	key := errMsg
	if i := strings.Index(key, "device "); i >= 0 {
		if j := strings.Index(key[i+7:], " "); j >= 0 {
			key = key[i : i+7+j]
		}
	}
	appKeyErrLastLogMu.Lock()
	defer appKeyErrLastLogMu.Unlock()
	now := time.Now()
	if last, ok := appKeyErrLastLog[key]; ok && now.Sub(last) < 5*time.Minute {
		return false
	}
	appKeyErrLastLog[key] = now
	return true
}

// startConcentratordPipeline starts the concentratord subscriber and runs the uplink pipeline
// (LoRaWAN → codec → store). If settings are not valid (event_url, command_url, region), it returns without starting.
// runtime is updated on every up/stats (UpdateLastSeen) and on gateway_id discovery (SetGatewayID).
func startConcentratordPipeline(ctx context.Context, app core.App, cfg *gateway.Config, runtime *GatewayRuntimeState) {
	if !cfg.Valid() {
		status := configStatus(*cfg, true)
		log.Printf("concentratord: pipeline skipped (config invalid, status=%s); save gateway settings in UI to connect", status)
		return
	}
	log.Printf("concentratord: pipeline starting event_url=%v command_url=%v region=%s", cfg.EventURL != "", cfg.CommandURL != "", cfg.Region)
	if runtime == nil {
		runtime = &GatewayRuntimeState{}
	}
	store := newPocketbaseLorawanStore(app)
	client := concentratord.NewClient(cfg.EventURL, cfg.CommandURL)
	if !client.Enabled() {
		return
	}
	if cfg.GatewayID == "" {
		discoverCtx, cancel := context.WithTimeout(ctx, gatewayIDDiscoverTimeout)
		id, err := client.GetGatewayID(discoverCtx)
		cancel()
		if err != nil {
			log.Printf("concentratord: gateway_id discovery: %v (continuing without)", err)
		} else if id != "" {
			cfg.GatewayID = id
			runtime.SetGatewayID(id)
			log.Printf("concentratord: gateway_id discovered: %s", id)
		}
	}
	if cfg.GatewayID != "" {
		runtime.SetGatewayID(cfg.GatewayID)
	}
	if cfg.GatewayID == "" {
		log.Printf("concentratord: gateway_id unset — gateway-status and UI will show 'no gateway online' until uplinks or stats are received")
	}
	// Push channel config for region (optional; concentratord normally uses file-based config).
	if gwc := gateway.GatewayConfigForRegion(cfg.Region, cfg.GatewayID); gwc != nil {
		if err := client.SendConfig(ctx, gwc); err != nil {
			log.Printf("concentratord: SendConfig: %v (continuing)", err)
		}
	}
	go func() {
		err := client.Run(ctx, func(frame *gw.UplinkFrame) {
			runtime.UpdateLastSeen()
			handleConcentratordUplink(app, frame, store, client, cfg)
		}, func(stats *gw.GatewayStats) {
			_ = stats // unused for now; last_seen is enough for online status
			runtime.UpdateLastSeen()
		})
		if err != nil && ctx.Err() == nil {
			log.Printf("concentratord Run: %v", err)
		}
	}()
	log.Printf("concentratord pipeline started (event=%s command=%s gateway_id=%t)", cfg.EventURL, cfg.CommandURL, cfg.GatewayID != "")
}

func handleConcentratordUplink(app core.App, frame *gw.UplinkFrame, store *pocketbaseLorawanStore, downlinkSender *concentratord.Client, cfg *gateway.Config) {
	phyRaw := frame.GetPhyPayload()
	if len(phyRaw) == 0 {
		log.Printf("uplink: ignored (empty phy payload)")
		return
	}
	var gwID string
	var rssi *int
	var snr *float64
	if rx := frame.GetRxInfo(); rx != nil {
		gwID = rx.GetGatewayId()
		r := int(rx.GetRssi())
		rssi = &r
		s := float64(rx.GetSnr())
		snr = &s
	}
	rssiVal, snrVal := interface{}("—"), interface{}("—")
	if rssi != nil {
		rssiVal = *rssi
	}
	if snr != nil {
		snrVal = *snr
	}
	log.Printf("uplink: received phy_len=%d rssi=%v snr=%v", len(phyRaw), rssiVal, snrVal)
	opts := &lorawan.ProcessUplinkOptions{RXDelay: gateway.DataDownlinkRX1DelaySec}
	result, err := lorawan.ProcessUplink(phyRaw, store, store, opts)
	if err != nil {
		errMsg := err.Error()
		if shouldLogAppKeyErr(errMsg) {
			log.Printf("uplink: lorawan error: %v (persisting raw frame)", err)
		}
		RecordUplinkDecodeFailed(app, phyRaw, rssi, snr, gwID, errMsg)
		return
	}
	if len(result.JoinAcceptPHY) > 0 {
		RecordUplink(app, "", 0, "join", result.Payload, len(phyRaw), rssi, snr, gwID)
		profile := gateway.ProfileForRegion(cfg.Region)
		// JoinAccept must be transmitted at JOIN_ACCEPT_DELAY1 = 5s after the JoinRequest.
		// The device opens its JoinAccept RX1 window at exactly +5s (LoRaWAN spec JOIN_ACCEPT_DELAY1).
		df := gateway.BuildClassADownlink(cfg, profile, result.JoinAcceptPHY, frame, gateway.JoinAcceptDelaySec)
		// Send in a goroutine so the SUB receive loop is not blocked waiting for the TX ack.
		// This allows back-to-back join retransmits to be processed immediately.
		go func(df *gw.DownlinkFrame) {
			ack, err := downlinkSender.SendDownlink(context.Background(), df)
			ackStatus := "OK"
			if err != nil {
				ackStatus = err.Error()
				log.Printf("uplink: join → JoinAccept send failed: %v", err)
			} else {
				gateway.LogDownlinkAck(ack, "JoinAccept")
				if s := gateway.DownlinkAckSummary(ack); s != "" {
					ackStatus = s
				}
				freqHz := uint32(0)
				if len(df.GetItems()) > 0 && df.GetItems()[0].GetTxInfo() != nil {
					freqHz = df.GetItems()[0].GetTxInfo().GetFrequency()
				}
				log.Printf("uplink: join → JoinAccept sent (RX1 %ds, freq=%d Hz) → gateway ack: %s", gateway.JoinAcceptDelaySec, freqHz, ackStatus)
			}
			RecordDownlink(app, "", 0, "join_accept", result.JoinAcceptPHY, len(result.JoinAcceptPHY), ackStatus)
		}(df)
		return
	}
	// Data uplink: decode and persist.
	obj := codec.DecodeUplink(result.FPort, result.Payload)
	deviceName := result.DevEUI
	if rec, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": result.DevEUI}); err == nil {
		if n, _ := rec.Get("device_name").(string); n != "" {
			deviceName = n
		}
	}
	RecordUplink(app, result.DevEUI, result.FPort, "data", result.Payload, len(phyRaw), rssi, snr, gwID)
	if err := handleUplinkFromPipeline(app, result.DevEUI, deviceName, result.FPort, obj, rssi, snr, cfg); err != nil {
		log.Printf("uplink: persist error dev_eui=%s f_port=%d: %v", result.DevEUI, result.FPort, err)
		return
	}
	log.Printf("uplink: dev_eui=%s f_port=%d (rssi=%v snr=%v)", result.DevEUI, result.FPort, rssiVal, snrVal)
	if result.NeedsACK {
		profile := gateway.ProfileForRegion(cfg.Region)
		ackPHY, err := lorawan.BuildAck(result.DevEUI, store)
		if err != nil {
			log.Printf("uplink: build ack error dev_eui=%s: %v", result.DevEUI, err)
			return
		}
		df := gateway.BuildClassADownlink(cfg, profile, ackPHY, frame, gateway.DataDownlinkRX1DelaySec)
		go func(df *gw.DownlinkFrame) {
			ack, err := downlinkSender.SendDownlink(context.Background(), df)
			if err != nil {
				log.Printf("uplink: ack send error dev_eui=%s: %v", result.DevEUI, err)
			} else {
				gateway.LogDownlinkAck(ack, "DataACK:"+result.DevEUI)
			}
		}(df)
	}
}

// EnqueueDownlink sends a downlink to the device via concentratord.
// Returns an error if gateway config is not enabled.
func EnqueueDownlink(cfg *gateway.Config, app core.App, devEUI string, fPort uint8, payload []byte) error {
	devEUI = normalizeEui(devEUI)
	if !cfg.Valid() {
		return fmt.Errorf("gateway not configured: save gateway settings in UI (event_url, command_url, region)")
	}
	store := newPocketbaseLorawanStore(app)
	phyRaw, err := lorawan.BuildDataDownlink(devEUI, fPort, payload, store)
	if err != nil {
		return err
	}
	client := concentratord.NewClient(cfg.EventURL, cfg.CommandURL)
	profile := gateway.ProfileForRegion(cfg.Region)
	df := gateway.BuildImmediateDownlink(cfg, profile, phyRaw)
	_, err = client.SendDownlink(context.Background(), df)
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	RecordDownlink(app, devEUI, fPort, "data", payload, len(phyRaw), errMsg)
	return err
}
