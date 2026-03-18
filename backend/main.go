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

	"github.com/kisinga/farmon/internal/gateway"
)

func main() {
	app := pocketbase.New()
	// JSVM + migratecmd with TemplateLangJS: pb_migrations/*.js run automatically on serve (see https://pocketbase.io/docs/js-migrations/).
	jsvm.MustRegister(app, jsvm.Config{})
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{TemplateLang: migratecmd.TemplateLangJS})
	gwCfg := gateway.DefaultGatewayConfig()
	gwRuntime := &GatewayRuntimeState{}
	gwState := &GatewayState{cfg: &gwCfg, runtime: gwRuntime}
	workflowEngine = NewWorkflowEngine(app, gwState)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Ensure lorawan_frames collection exists (creates from Go if JS migration did not run)
		ensureLorawanFramesCollection(app)
		// Ensure firmware collections exist (firmware_commands + backend_info)
		ensureFirmwareCollections(app)
		// Seed default device profiles (FarMon Water Monitor, SenseCAP S2105)
		seedDefaultProfiles(app)
		// Seed firmware commands + backend_info
		seedFirmwareData(app)
		// Load gateway config from DB; start pipeline only if a valid record exists (event_url, command_url, region set)
		cfg, valid := loadGatewaySettings(app)
		if valid {
			gwState.SetConfig(cfg)
		} else {
			// No valid config from DB: assume invalid so pipeline does not start unless we bootstrap
			invalid := gateway.DefaultGatewayConfig()
			invalid.EventURL = ""
			invalid.CommandURL = ""
			gwState.SetConfig(invalid)
			// If no record at all, bootstrap default so pipeline starts on first deploy without user opening UI
			rec, recErr := getGatewaySettingsRecord(app)
			if recErr != nil || rec == nil {
				_ = saveGatewaySettings(app, gateway.DefaultGatewayConfig())
				if cfg2, valid2 := loadGatewaySettings(app); valid2 {
					gwState.SetConfig(cfg2)
				}
			}
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
		// Device provisioning & targets
		se.Router.POST("/api/farmon/devices", provisionDeviceHandler(app))
		se.Router.DELETE("/api/farmon/devices", deleteDeviceHandler(app))
		se.Router.GET("/api/farmon/device-targets", deviceTargetsHandler(app))

		// Device profiles
		se.Router.GET("/api/farmon/profiles", listProfilesHandler(app))
		se.Router.GET("/api/farmon/profiles/{id}", getProfileHandler(app))
		se.Router.POST("/api/farmon/profiles", createProfileHandler(app))
		se.Router.PATCH("/api/farmon/profiles/{id}", updateProfileHandler(app))
		se.Router.DELETE("/api/farmon/profiles/{id}", deleteProfileHandler(app))
		se.Router.POST("/api/farmon/profiles/{id}/test-decode", testDecodeHandler(app))
		se.Router.POST("/api/farmon/validate-airconfig", validateAirConfigHandler())

		// Device config
		se.Router.POST("/api/farmon/devices/{eui}/push-config", pushConfigHandler(app, gwState))
		se.Router.POST("/api/farmon/devices/{eui}/push-rules", pushRulesHandler(app, gwState))
		se.Router.POST("/api/farmon/devices/{eui}/push-sensor-slot", pushSensorSlotHandler(app, gwState))
		se.Router.PATCH("/api/farmon/devices/{eui}/overrides", updateDeviceOverridesHandler(app))

		// WiFi device ingest (transport-agnostic uplink via HTTP POST)
		se.Router.POST("/api/farmon/ingest", ingestHandler(app, gwState))

		// Test: inject uplink bypassing ZMQ/LoRaWAN (exercises decode engine + DB writes)
		se.Router.POST("/api/farmon/test/inject-uplink", injectUplinkHandler(app, gwState))

		// Gateway & pipeline
		se.Router.POST("/api/farmon/pipeline/restart", pipelineRestartHandler(app, gwState))
		se.Router.POST("/api/farmon/setControl", setControlHandler(app, gwState))
		se.Router.GET("/api/farmon/gateway-status", gatewayStatusHandler(gwState))
		se.Router.GET("/api/farmon/gateway-settings/effective", gatewaySettingsEffectiveHandler(gwState))
		se.Router.GET("/api/farmon/debug/pipeline", pipelineDebugHandler(app, gwState))
		se.Router.GET("/api/farmon/lorawan/frames", lorawanFramesHandler(app))
		se.Router.GET("/api/farmon/lorawan/stats", lorawanStatsHandler(app, gwState))
		se.Router.POST("/api/farmon/sendCommand", sendCommandHandler(app, gwState))

		// Firmware commands (read-only, sourced from protocol package)
		se.Router.GET("/api/farmon/firmware-commands", listFirmwareCommandsHandler(app))

		// Sensor catalog (read-only, sourced from sensors package)
		se.Router.GET("/api/farmon/sensor-catalog", sensorCatalogHandler())

		// Backend compatibility declaration
		se.Router.GET("/api/farmon/backend-info", getBackendInfoHandler(app))
		se.Router.PATCH("/api/farmon/backend-info", patchBackendInfoHandler(app))

		// Workflow engine: load workflows, start background scheduler, and register routes
		if err := workflowEngine.LoadWorkflows(); err != nil {
			log.Printf("workflow: initial load error: %v", err)
		}
		go RunScheduler(app, workflowEngine, gwState)
		reloadWorkflows := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			go workflowEngine.LoadWorkflows()
			return nil
		}
		app.OnRecordAfterCreateSuccess("workflows").BindFunc(reloadWorkflows)
		app.OnRecordAfterUpdateSuccess("workflows").BindFunc(reloadWorkflows)
		app.OnRecordAfterDeleteSuccess("workflows").BindFunc(reloadWorkflows)

		// Profile-to-device sync: when profile sub-components change, propagate to all linked devices.
		syncProfileHook := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			profileID := e.Record.GetString("profile")
			if profileID != "" {
				syncProfileToDevices(app, profileID)
			}
			return nil
		}
		for _, collection := range []string{"profile_fields", "profile_controls", "profile_commands", "profile_airconfig"} {
			app.OnRecordAfterCreateSuccess(collection).BindFunc(syncProfileHook)
			app.OnRecordAfterUpdateSuccess(collection).BindFunc(syncProfileHook)
			app.OnRecordAfterDeleteSuccess(collection).BindFunc(syncProfileHook)
		}

		se.Router.GET("/api/farmon/workflows", listWorkflowsHandler(app))
		se.Router.POST("/api/farmon/workflows", createWorkflowHandler(app, workflowEngine))
		se.Router.PATCH("/api/farmon/workflows/{id}", updateWorkflowHandler(app, workflowEngine))
		se.Router.DELETE("/api/farmon/workflows/{id}", deleteWorkflowHandler(app, workflowEngine))
		se.Router.POST("/api/farmon/workflows/{id}/test", testWorkflowHandler(app, workflowEngine))
		se.Router.GET("/api/farmon/workflow-log", listWorkflowLogHandler(app))
		se.Router.GET("/api/farmon/device-workflow-events", deviceWorkflowEventsHandler(app))

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
