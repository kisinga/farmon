package main

import (
	"encoding/json"
	"log"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// RunScheduler runs the background scheduler in a goroutine.
// It handles two jobs:
//  1. Cron ticker (every 60s): fires TriggerSchedule workflows whose cron expression matches.
//  2. Action poller (every 5s): executes delayed workflow actions whose execute_at has passed.
//
// On startup, any overdue pending scheduled_actions are drained immediately before the
// ticker loops begin, so actions survive process restarts.
func RunScheduler(app core.App, engine *WorkflowEngine) {
	// Drain overdue scheduled actions left from a previous run.
	drainScheduledActions(app, engine)

	cronTicker := time.NewTicker(60 * time.Second)
	actionTicker := time.NewTicker(5 * time.Second)
	defer cronTicker.Stop()
	defer actionTicker.Stop()

	for {
		select {
		case t := <-cronTicker.C:
			engine.FireScheduled(t)
		case <-actionTicker.C:
			drainScheduledActions(app, engine)
		}
	}
}

// drainScheduledActions queries pending scheduled_actions whose execute_at <= now,
// executes them via the workflow engine, and marks them done or failed.
// Processes up to 20 records per call to avoid blocking the goroutine.
func drainScheduledActions(app core.App, engine *WorkflowEngine) {
	now := time.Now().Format(time.RFC3339)
	recs, err := app.FindRecordsByFilter(
		"scheduled_actions",
		"status = 'pending' && execute_at <= {:now}",
		"execute_at", 20, 0,
		dbx.Params{"now": now},
	)
	if err != nil || len(recs) == 0 {
		return
	}

	for _, rec := range recs {
		var action WorkflowAction
		if err := json.Unmarshal([]byte(rec.GetString("action_json")), &action); err != nil {
			markScheduledAction(app, rec, "failed", "invalid action_json: "+err.Error())
			continue
		}
		if err := engine.executeAction(action); err != nil {
			log.Printf("scheduler: action failed wf=%s: %v", rec.GetString("workflow_id"), err)
			markScheduledAction(app, rec, "failed", err.Error())
		} else {
			markScheduledAction(app, rec, "done", "")
		}
	}
}

func markScheduledAction(app core.App, rec *core.Record, status, errMsg string) {
	rec.Set("status", status)
	if errMsg != "" {
		rec.Set("error_message", errMsg)
	}
	_ = app.Save(rec)
}
