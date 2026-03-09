package main

import (
	"log"
	"net/http"
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
		// Load gateway config from DB; start pipeline only if a valid record exists (event_url, command_url, region set)
		if cfg, valid := loadGatewaySettings(app); valid {
			gwState.SetConfig(cfg)
		} else {
			// No record or incomplete: keep in-memory config invalid so pipeline does not start
			invalid := gateway.DefaultGatewayConfig()
			invalid.EventURL = ""
			invalid.CommandURL = ""
			gwState.SetConfig(invalid)
		}
		gwState.RestartPipeline(app)

		// Custom app API under /api/farmon (SDK handles collections: devices list, gateway_settings, telemetry, etc.)
		farmon := se.Router.Group("/api/farmon")
		farmon.POST("/devices", provisionDeviceHandler(app))
		farmon.DELETE("/devices", deleteDeviceHandler(app))
		farmon.POST("/pipeline/restart", pipelineRestartHandler(app, gwState))
		farmon.POST("/setControl", setControlHandler(app, &gwCfg))
		farmon.GET("/gateway-status", gatewayStatusHandler(&gwCfg))
		farmon.GET("/debug/pipeline", pipelineDebugHandler(&gwCfg))
		lorawan := farmon.Group("/lorawan")
		lorawan.GET("/frames", lorawanFramesHandler())
		lorawan.POST("/frames/clear", lorawanClearFramesHandler())
		lorawan.GET("/stats", lorawanStatsHandler(&gwCfg))
		farmon.POST("/ota/start", otaStartHandler(app))
		farmon.POST("/ota/cancel", otaCancelHandler(app))

		// SPA under /app/ so /api is never matched by static; SDK collection requests reach PocketBase API.
		se.Router.GET("/", func(e *core.RequestEvent) error {
			return e.Redirect(http.StatusFound, "/app/")
		})
		se.Router.GET("/app/{path...}", apis.Static(os.DirFS("./pb_public"), true))

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
