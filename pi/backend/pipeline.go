package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/codec"
	"github.com/kisinga/farmon/pi/internal/concentratord"
	"github.com/kisinga/farmon/pi/internal/lorawan"
)

// startConcentratordPipeline starts the concentratord subscriber and runs the uplink pipeline
// (LoRaWAN → codec → store). If Concentratord is not configured, it returns without starting.
func startConcentratordPipeline(ctx context.Context, app core.App) {
	eventURL := os.Getenv("CONCENTRATORD_EVENT_URL")
	commandURL := os.Getenv("CONCENTRATORD_COMMAND_URL")
	gatewayID := os.Getenv("CONCENTRATORD_GATEWAY_ID")
	log.Printf("concentratord: event_url=%v command_url=%v gateway_id=%v", eventURL != "", commandURL != "", gatewayID != "")
	if eventURL == "" || commandURL == "" {
		log.Printf("concentratord: not configured (set CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL); no uplinks will be received")
		return
	}
	store := newPocketbaseLorawanStore(app)
	codecRunner, err := codec.NewRunner(os.Getenv("CODEC_PATH"))
	if err != nil {
		log.Printf("pipeline: codec init: %v (uplink from concentratord will not decode)", err)
		codecRunner = nil
	}
	client := concentratord.NewClient(eventURL, commandURL)
	if !client.Enabled() {
		return
	}
	if gatewayID == "" {
		log.Printf("concentratord: CONCENTRATORD_GATEWAY_ID unset — gateway-status and UI will show 'no gateway online'")
	}
	go func() {
		err := client.Run(ctx, func(frame *gw.UplinkFrame) {
			handleConcentratordUplink(app, frame, store, codecRunner, client)
		})
		if err != nil && ctx.Err() == nil {
			log.Printf("concentratord Run: %v", err)
		}
	}()
	log.Printf("concentratord pipeline started (event=%s command=%s gateway_id=%t)", eventURL, commandURL, gatewayID != "")
}

func handleConcentratordUplink(app core.App, frame *gw.UplinkFrame, store *pocketbaseLorawanStore, codecRunner *codec.Runner, downlinkSender *concentratord.Client) {
	phyRaw := frame.GetPhyPayload()
	if len(phyRaw) == 0 {
		log.Printf("uplink: ignored (empty phy payload)")
		return
	}
	result, err := lorawan.ProcessUplink(phyRaw, store, store)
	if err != nil {
		log.Printf("uplink: lorawan error: %v", err)
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
		log.Printf("uplink: join → sending JoinAccept")
		RecordUplink("", 0, "join", result.Payload, len(phyRaw), rssi, snr, gwID)
		// Send JoinAccept downlink with context from uplink so gateway can schedule RX1.
		df := buildDownlinkFrame(result.JoinAcceptPHY, frame)
		if _, err := downlinkSender.SendDownlink(context.Background(), df); err != nil {
			log.Printf("send JoinAccept: %v", err)
			RecordDownlink("", 0, "join_accept", nil, len(result.JoinAcceptPHY), err.Error())
		} else {
			RecordDownlink("", 0, "join_accept", result.JoinAcceptPHY, len(result.JoinAcceptPHY), "")
		}
		return
	}
	// Data uplink: decode with codec and persist.
	var obj map[string]any
	if codecRunner != nil {
		obj, _ = codecRunner.DecodeUplink(result.FPort, result.Payload)
	}
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

// buildDownlinkFrame builds a gw.DownlinkFrame for JoinAccept (or any PHY) with optional uplink context.
func buildDownlinkFrame(phyPayload []byte, uplink *gw.UplinkFrame) *gw.DownlinkFrame {
	df := &gw.DownlinkFrame{
		Items: []*gw.DownlinkFrameItem{{
			PhyPayload: phyPayload,
			TxInfo:     &gw.DownlinkTxInfo{},
		}},
	}
	if rx := uplink.GetRxInfo(); rx != nil {
		df.GatewayId = rx.GetGatewayId()
		df.Items[0].TxInfo.Context = rx.GetContext()
		// Use immediately timing if no context; otherwise gateway uses context for Class A.
		if len(rx.GetContext()) == 0 {
			df.Items[0].TxInfo.Timing = &gw.Timing{Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}}}
		}
	} else {
		df.Items[0].TxInfo.Timing = &gw.Timing{Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}}}
	}
	return df
}

// EnqueueDownlink sends a downlink to the device via concentratord.
// Returns an error if CONCENTRATORD_EVENT_URL or CONCENTRATORD_COMMAND_URL are not set.
func EnqueueDownlink(app core.App, devEUI string, fPort uint8, payload []byte) error {
	devEUI = normalizeEui(devEUI)
	eventURL := os.Getenv("CONCENTRATORD_EVENT_URL")
	commandURL := os.Getenv("CONCENTRATORD_COMMAND_URL")
	if eventURL == "" || commandURL == "" {
		return fmt.Errorf("gateway not configured: set CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL")
	}
	store := newPocketbaseLorawanStore(app)
	phyRaw, err := lorawan.BuildDataDownlink(devEUI, fPort, payload, store)
	if err != nil {
		return err
	}
	client := concentratord.NewClient(eventURL, commandURL)
	df := &gw.DownlinkFrame{
		GatewayId: os.Getenv("CONCENTRATORD_GATEWAY_ID"),
		Items: []*gw.DownlinkFrameItem{{
			PhyPayload: phyRaw,
			TxInfo: &gw.DownlinkTxInfo{
				Timing: &gw.Timing{Parameters: &gw.Timing_Immediately{Immediately: &gw.ImmediatelyTimingInfo{}}},
			},
		}},
	}
	_, err = client.SendDownlink(context.Background(), df)
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	RecordDownlink(devEUI, fPort, "data", payload, len(phyRaw), errMsg)
	return err
}
