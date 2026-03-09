package main

import (
	"log"
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

func main() {
	app := pocketbase.New()
	// JSVM + migratecmd with TemplateLangJS: pb_migrations/*.js run automatically on serve (see https://pocketbase.io/docs/js-migrations/).
	jsvm.MustRegister(app, jsvm.Config{})
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{TemplateLang: migratecmd.TemplateLangJS})
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

		// When gateway_settings are saved (create or update), reload config and restart pipeline so we don't rely on frontend calling pipeline/restart.
		restartPipelineOnGatewaySettingsSave := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			go func() {
				cfg, valid := loadGatewaySettings(e.App)
				if valid {
					gwState.SetConfig(cfg)
					gwState.RestartPipeline(e.App)
				}
			}()
			return nil
		}
		app.OnRecordAfterCreateSuccess("gateway_settings").BindFunc(restartPipelineOnGatewaySettingsSave)
		app.OnRecordAfterUpdateSuccess("gateway_settings").BindFunc(restartPipelineOnGatewaySettingsSave)

		// Custom app API under /api/farmon only. Do NOT register routes under /api/ without the /farmon/ prefix,
		// so PocketBase's built-in /api/collections/* and /api/records/* (used by the SDK) remain reachable.
		se.Router.POST("/api/farmon/devices", provisionDeviceHandler(app))
		se.Router.DELETE("/api/farmon/devices", deleteDeviceHandler(app))
		se.Router.POST("/api/farmon/pipeline/restart", pipelineRestartHandler(app, gwState))
		se.Router.POST("/api/farmon/setControl", setControlHandler(app, gwState))
		se.Router.GET("/api/farmon/gateway-status", gatewayStatusHandler(gwState))
		se.Router.GET("/api/farmon/debug/pipeline", pipelineDebugHandler(app, gwState))
		se.Router.GET("/api/farmon/lorawan/stats", lorawanStatsHandler(app, gwState))
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
