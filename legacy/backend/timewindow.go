package main

import (
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// checkTimeWindows evaluates all rules with time windows and updates
// the window_active flag when the current time enters or exits a window.
// If any rule's window_active changes, the affected device's rules are re-pushed.
func checkTimeWindows(app core.App, gwState *GatewayState, now time.Time) {
	currentHour := now.Hour()

	// Find all rules with a time window defined (time_start >= 0 AND time_end >= 0).
	recs, err := app.FindRecordsByFilter(
		"device_rules",
		"time_start >= 0 && time_end >= 0",
		"device_eui", 0, 0, nil,
	)
	if err != nil || len(recs) == 0 {
		return
	}

	// Track which devices need a rule push.
	devicesChanged := map[string]bool{}

	for _, rec := range recs {
		start := int(rec.GetFloat("time_start"))
		end := int(rec.GetFloat("time_end"))
		shouldBeActive := isInTimeWindow(currentHour, start, end)
		wasActive := rec.GetBool("window_active")

		if shouldBeActive != wasActive {
			rec.Set("window_active", shouldBeActive)
			if err := app.Save(rec); err != nil {
				log.Printf("time_windows: save error id=%s: %v", rec.Id, err)
				continue
			}
			devicesChanged[rec.GetString("device_eui")] = true
		}
	}

	// Push updated rules for each affected device.
	for eui := range devicesChanged {
		if err := pushRulesForDevice(app, gwState, eui); err != nil {
			log.Printf("time_windows: push rules error eui=%s: %v", eui, err)
		}
	}
}

// isInTimeWindow checks if currentHour falls within [start, end).
// Handles overnight wrapping (e.g., start=22, end=6 means active 22:00-05:59).
func isInTimeWindow(currentHour, start, end int) bool {
	if start <= end {
		// Normal window: e.g., 6-18 means 06:00-17:59
		return currentHour >= start && currentHour < end
	}
	// Overnight window: e.g., 22-6 means 22:00-05:59
	return currentHour >= start || currentHour < end
}

// pushRulesForDevice builds and enqueues a rule batch downlink for the given device.
func pushRulesForDevice(app core.App, gwState *GatewayState, eui string) error {
	records, err := app.FindRecordsByFilter(
		"device_rules",
		"device_eui = {:eui} && enabled = true",
		"rule_id", 0, 0, map[string]any{"eui": eui},
	)
	if err != nil || len(records) == 0 {
		return nil // no enabled rules to push
	}

	ruleMaps, extras, windowActive := extractRuleData(records)

	payload, err := buildRuleBatchPayload(ruleMaps, extras, windowActive)
	if err != nil {
		return err
	}

	cfg := gwState.Config()
	return EnqueueDownlinkForDevice(app, cfg, eui, 30, payload)
}
