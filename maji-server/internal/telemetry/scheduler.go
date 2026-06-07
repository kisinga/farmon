package telemetry

import (
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// RunScheduler runs the telemetry background jobs in a goroutine: rollup every
// 5 minutes and retention prune every hour. Both run once on startup so a
// restarted process catches up immediately.
func RunScheduler(app core.App) {
	if err := Rollup(app, time.Now()); err != nil {
		log.Printf("telemetry: initial rollup: %v", err)
	}
	if err := Prune(app, time.Now()); err != nil {
		log.Printf("telemetry: initial prune: %v", err)
	}

	rollupTicker := time.NewTicker(5 * time.Minute)
	pruneTicker := time.NewTicker(1 * time.Hour)
	defer rollupTicker.Stop()
	defer pruneTicker.Stop()

	for {
		select {
		case t := <-rollupTicker.C:
			if err := Rollup(app, t); err != nil {
				log.Printf("telemetry: rollup: %v", err)
			}
		case t := <-pruneTicker.C:
			if err := Prune(app, t); err != nil {
				log.Printf("telemetry: prune: %v", err)
			}
		}
	}
}
