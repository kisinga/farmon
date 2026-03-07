package main

import (
	"context"
	"log"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Ensure collections exist (run after DB is ready; OnBootstrap is too early)
		bootstrapCollections(app)
		// Start concentratord pipeline when CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL are set
		startConcentratordPipeline(context.Background(), app)
		// Device provisioning (LoRaWAN OTAA): create device + AppKey, get credentials
		se.Router.POST("/api/devices", provisionDeviceHandler(app))
		se.Router.GET("/api/devices/credentials", deviceCredentialsHandler(app))
		// Custom app API (downlink / gateway)
		se.Router.POST("/api/setControl", setControlHandler(app))
		se.Router.GET("/api/gateway-status", gatewayStatusHandler(app))
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
