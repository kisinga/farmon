package main

import (
	"crypto/rand"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/dbx"
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
	wifiState := &WifiState{}
	workflowEngine = NewWorkflowEngine(app, gwState)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Ensure lorawan_frames collection exists (creates from Go if JS migration did not run)
		ensureLorawanFramesCollection(app)
		// Ensure firmware collections exist (firmware_commands + backend_info)
		ensureFirmwareCollections(app)
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

		// Load WiFi settings; bootstrap defaults if no record exists
		wifiCfg, wifiFound := loadWifiSettings(app)
		if !wifiFound {
			_ = saveWifiSettings(app, WifiConfig{Enabled: true, TestMode: false})
			wifiCfg = WifiConfig{Enabled: true, TestMode: false}
		}
		wifiState.SetConfig(wifiCfg)

		reloadWifiSettings := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			go func() {
				cfg, _ := loadWifiSettings(e.App)
				wifiState.SetConfig(cfg)
			}()
			return nil
		}
		app.OnRecordAfterCreateSuccess("wifi_settings").BindFunc(reloadWifiSettings)
		app.OnRecordAfterUpdateSuccess("wifi_settings").BindFunc(reloadWifiSettings)

		// Custom app API under /api/farmon only. Do NOT register routes under /api/ without the /farmon/ prefix,
		// so PocketBase's built-in /api/collections/* and /api/records/* (used by the SDK) remain reachable.
		// Device provisioning
		se.Router.POST("/api/farmon/devices", provisionDeviceHandler(app))
		se.Router.DELETE("/api/farmon/devices", deleteDeviceHandler(app))

		// Device spec & config
		se.Router.GET("/api/farmon/devices/{eui}/spec", getDeviceSpecHandler(app))
		se.Router.POST("/api/farmon/devices/{eui}/apply-spec", applySpecHandler(app))
		se.Router.POST("/api/farmon/test-decode", testDecodeHandler(app))
		se.Router.POST("/api/farmon/validate-airconfig", validateAirConfigHandler())
		se.Router.POST("/api/farmon/devices/{eui}/push-config", pushConfigHandler(app, gwState))
		se.Router.POST("/api/farmon/devices/{eui}/push-rules", pushRulesHandler(app, gwState))
		se.Router.POST("/api/farmon/devices/{eui}/push-sensor-slot", pushSensorSlotHandler(app, gwState))
		// WiFi device ingest (transport-agnostic uplink via HTTP POST)
		se.Router.POST("/api/farmon/ingest", ingestHandler(app, gwState, wifiState))

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

		se.Router.GET("/api/farmon/workflows", listWorkflowsHandler(app))
		se.Router.POST("/api/farmon/workflows", createWorkflowHandler(app, workflowEngine))
		se.Router.PATCH("/api/farmon/workflows/{id}", updateWorkflowHandler(app, workflowEngine))
		se.Router.DELETE("/api/farmon/workflows/{id}", deleteWorkflowHandler(app, workflowEngine))
		se.Router.POST("/api/farmon/workflows/{id}/test", testWorkflowHandler(app, workflowEngine))
		se.Router.GET("/api/farmon/workflow-log", listWorkflowLogHandler(app))
		se.Router.GET("/api/farmon/device-workflow-events", deviceWorkflowEventsHandler(app))

		// Bootstrap the frontend service user and expose its credentials via a local endpoint.
		seedFrontendUser(app)
		se.Router.GET("/api/farmon/ui-config", uiConfigHandler(app))

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

const uiFrontendEmail = "ui@farmon.local"

// seedFrontendUser ensures a PocketBase user exists for frontend authentication.
// On first run the password is taken from FARMON_UI_PASSWORD env var (or auto-generated),
// written to pb_data/ui_secret, and logged once. On subsequent runs the password is read
// from the file and the user is recreated if the DB was wiped.
func seedFrontendUser(app core.App) {
	secretPath := filepath.Join(app.DataDir(), "ui_secret")

	var password string
	data, err := os.ReadFile(secretPath)
	if err == nil {
		password = strings.TrimSpace(string(data))
	} else {
		// First run: use env var or generate
		password = os.Getenv("FARMON_UI_PASSWORD")
		if password == "" {
			password = generateRandomPassword(20)
		}
		if writeErr := os.WriteFile(secretPath, []byte(password), 0600); writeErr != nil {
			log.Printf("[farmon] WARNING: could not write ui_secret: %v", writeErr)
		}
		log.Printf("[farmon] Frontend user created — email: %s  password: %s", uiFrontendEmail, password)
	}

	usersCol, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		log.Printf("[farmon] WARNING: could not find users collection: %v", err)
		return
	}

	existing, _ := app.FindFirstRecordByFilter(usersCol.Id, "email = {:email}", dbx.Params{"email": uiFrontendEmail})
	if existing != nil {
		return
	}

	record := core.NewRecord(usersCol)
	record.Set("email", uiFrontendEmail)
	record.SetPassword(password)
	record.Set("emailVisibility", true)
	record.Set("verified", true)
	if saveErr := app.Save(record); saveErr != nil {
		log.Printf("[farmon] WARNING: could not create frontend user: %v", saveErr)
	}
}

// uiConfigHandler returns the frontend service user credentials so the Angular app
// can authenticate with PocketBase on startup.
func uiConfigHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		secretPath := filepath.Join(app.DataDir(), "ui_secret")
		data, err := os.ReadFile(secretPath)
		if err != nil {
			return e.JSON(http.StatusServiceUnavailable, map[string]string{"error": "not configured"})
		}
		return e.JSON(http.StatusOK, map[string]string{
			"email":    uiFrontendEmail,
			"password": strings.TrimSpace(string(data)),
		})
	}
}

const passwordChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateRandomPassword(length int) string {
	buf := make([]byte, length)
	for i := range buf {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(passwordChars))))
		buf[i] = passwordChars[n.Int64()]
	}
	return string(buf)
}
