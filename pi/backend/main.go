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
	gwRuntime := &GatewayRuntimeState{}
	gwState := &GatewayState{cfg: &gwCfg, runtime: gwRuntime}

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

		// Custom app API under /api/farmon only. Do NOT register routes under /api/ without the /farmon/ prefix,
		// so PocketBase's built-in /api/collections/* and /api/records/* (used by the SDK) remain reachable.
		se.Router.POST("/api/farmon/devices", provisionDeviceHandler(app))
		se.Router.DELETE("/api/farmon/devices", deleteDeviceHandler(app))
		se.Router.POST("/api/farmon/pipeline/restart", pipelineRestartHandler(app, gwState))
		se.Router.POST("/api/farmon/setControl", setControlHandler(app, gwState))
		se.Router.GET("/api/farmon/gateway-status", gatewayStatusHandler(gwState))
		se.Router.GET("/api/farmon/debug/pipeline", pipelineDebugHandler(gwState))
		se.Router.GET("/api/farmon/lorawan/frames", lorawanFramesHandler())
		se.Router.POST("/api/farmon/lorawan/frames/clear", lorawanClearFramesHandler())
		se.Router.GET("/api/farmon/lorawan/stats", lorawanStatsHandler(gwState))
		se.Router.POST("/api/farmon/ota/start", otaStartHandler(app))
		se.Router.POST("/api/farmon/ota/cancel", otaCancelHandler(app))

		// SPA under /app/ so /api is never matched by static; SDK collection requests go to /api/collections/*.
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
