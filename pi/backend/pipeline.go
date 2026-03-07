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
// (LoRaWAN → codec → store). If Concentratord is not configured, it returns without starting.
func startConcentratordPipeline(ctx context.Context, app core.App, cfg *gateway.Config) {
	log.Printf("concentratord: event_url=%v command_url=%v gateway_id=%v rx1_delay=%ds", cfg.EventURL != "", cfg.CommandURL != "", cfg.GatewayID != "", cfg.RX1DelaySec)
	if !cfg.Enabled() {
		log.Printf("concentratord: not configured (set CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL); no uplinks will be received")
		return
	}
	store := newPocketbaseLorawanStore(app)
	client := concentratord.NewClient(cfg.EventURL, cfg.CommandURL)
	if !client.Enabled() {
		return
	}
	if cfg.GatewayID == "" {
		log.Printf("concentratord: CONCENTRATORD_GATEWAY_ID unset — gateway-status and UI will show 'no gateway online'")
	}
	go func() {
		err := client.Run(ctx, func(frame *gw.UplinkFrame) {
			handleConcentratordUplink(app, frame, store, client, cfg)
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
	opts := &lorawan.ProcessUplinkOptions{RXDelay: uint8(cfg.RX1DelaySec)}
	if opts.RXDelay < 1 || opts.RXDelay > 15 {
		opts.RXDelay = 1
	}
	result, err := lorawan.ProcessUplink(phyRaw, store, store, opts)
	if err != nil {
		errMsg := err.Error()
		if shouldLogAppKeyErr(errMsg) {
			log.Printf("uplink: lorawan error: %v", err)
		}
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
	if len(result.JoinAcceptPHY) > 0 {
		log.Printf("uplink: join → sending JoinAccept (RX1 delay %ds)", cfg.RX1DelaySec)
		RecordUplink("", 0, "join", result.Payload, len(phyRaw), rssi, snr, gwID)
		df := gateway.BuildClassADownlink(cfg, result.JoinAcceptPHY, frame)
		ack, err := downlinkSender.SendDownlink(context.Background(), df)
		if err != nil {
			log.Printf("send JoinAccept: %v", err)
			RecordDownlink("", 0, "join_accept", nil, len(result.JoinAcceptPHY), err.Error())
		} else {
			gateway.LogDownlinkAck(ack, "JoinAccept")
			summary := gateway.DownlinkAckSummary(ack)
			if summary != "" {
				log.Printf("JoinAccept downlink ack: %s", summary)
			}
			RecordDownlink("", 0, "join_accept", result.JoinAcceptPHY, len(result.JoinAcceptPHY), summary)
		}
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
	RecordUplink(result.DevEUI, result.FPort, "data", result.Payload, len(phyRaw), rssi, snr, gwID)
	if err := handleUplinkFromPipeline(app, result.DevEUI, deviceName, result.FPort, obj, rssi, snr); err != nil {
		log.Printf("uplink: persist error dev_eui=%s f_port=%d: %v", result.DevEUI, result.FPort, err)
		return
	}
	log.Printf("uplink: dev_eui=%s f_port=%d (rssi=%v snr=%v)", result.DevEUI, result.FPort, rssi, snr)
}

// EnqueueDownlink sends a downlink to the device via concentratord.
// Returns an error if gateway config is not enabled.
func EnqueueDownlink(cfg *gateway.Config, app core.App, devEUI string, fPort uint8, payload []byte) error {
	devEUI = normalizeEui(devEUI)
	if !cfg.Enabled() {
		return fmt.Errorf("gateway not configured: set CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL")
	}
	store := newPocketbaseLorawanStore(app)
	phyRaw, err := lorawan.BuildDataDownlink(devEUI, fPort, payload, store)
	if err != nil {
		return err
	}
	client := concentratord.NewClient(cfg.EventURL, cfg.CommandURL)
	df := gateway.BuildImmediateDownlink(cfg, phyRaw)
	_, err = client.SendDownlink(context.Background(), df)
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	RecordDownlink(devEUI, fPort, "data", payload, len(phyRaw), errMsg)
	return err
}
