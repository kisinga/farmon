//go:build edge

// Command maji-edge is the single-tenant edge server. It excludes the tenant
// package at compile time.
package main

import (
	"log"

	"github.com/kisinga/majiflow/internal/config"
	"github.com/kisinga/majiflow/internal/server"
)

func main() {
	cfg := config.Load(config.ModeEdge)
	app := server.New(cfg)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
