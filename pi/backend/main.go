package main

import (
	"log"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

func main() {
	app := pocketbase.New()
	gwCfg := gateway.DefaultGatewayConfig()
	gwState := &GatewayState{cfg: &gwCfg}

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Ensure collections exist (run after DB is ready; OnBootstrap is too early)
		bootstrapCollections(app)
		// Load gateway config from DB; start pipeline only if a valid record exists (event_url, command_url, region set)
		if cfg, valid := LoadGatewaySettings(app); valid {
			gwState.SetConfig(cfg)
		} else {
			// No record or incomplete: keep in-memory config invalid so pipeline does not start
			invalid := gateway.DefaultGatewayConfig()
			invalid.EventURL = ""
			invalid.CommandURL = ""
			gwState.SetConfig(invalid)
		}
		gwState.RestartPipeline(app)

		// Device provisioning (LoRaWAN OTAA): create device + AppKey, get credentials
		se.Router.POST("/api/devices", provisionDeviceHandler(app))
		se.Router.DELETE("/api/devices", deleteDeviceHandler(app))
		se.Router.GET("/api/devices/credentials", deviceCredentialsHandler(app))
		// Gateway settings (DB only; gate on valid settings)
		se.Router.GET("/api/gateway-settings", getGatewaySettingsHandler(app))
		se.Router.PATCH("/api/gateway-settings", patchGatewaySettingsHandler(app, gwState))
		// Custom app API (downlink / gateway)
		se.Router.POST("/api/setControl", setControlHandler(app, &gwCfg))
		se.Router.GET("/api/gateway-status", gatewayStatusHandler(&gwCfg))
		se.Router.GET("/api/debug/pipeline", pipelineDebugHandler(&gwCfg))
		se.Router.GET("/api/lorawan/frames", lorawanFramesHandler())
		se.Router.GET("/api/lorawan/stats", lorawanStatsHandler(&gwCfg))
		se.Router.POST("/api/lorawan/frames/clear", lorawanClearFramesHandler())
		se.Router.GET("/api/history", historyHandler(app))
		se.Router.POST("/api/otaStart", otaStartHandler(app))
		se.Router.POST("/api/otaCancel", otaCancelHandler(app))

		// Serve static files (Angular SPA): embedded build (go build -tags embed) or pb_public
		se.Router.GET("/{path...}", apis.Static(os.DirFS("./pb_public"), false))

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
