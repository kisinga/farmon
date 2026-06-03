//go:build cloud

// Command maji-cloud is the multi-tenant cloud server.
package main

import (
	"log"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/server"
	"github.com/kisinga/majiflow/internal/tenant"
)

func main() {
	cfg := config.Load(config.ModeCloud)
	app := server.New(cfg)
	tenant.Register(app)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
