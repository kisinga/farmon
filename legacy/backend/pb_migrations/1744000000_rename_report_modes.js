/// <reference path="../pb_data/types.d.ts" />

// Migration: Rename report_mode values for clarity
// active   → reported
// event    → on_change
// internal → disabled

migrate(
  (app) => {
    const fields = app.findRecordsByFilter("device_fields", "1=1", "", 0, 0)
    const remap = { "active": "reported", "event": "on_change", "internal": "disabled" }
    for (const f of fields) {
      const current = f.getString("report_mode")
      const next = remap[current]
      if (next) {
        f.set("report_mode", next)
        app.save(f)
      }
    }
  },
  (app) => {
    const fields = app.findRecordsByFilter("device_fields", "1=1", "", 0, 0)
    const remap = { "reported": "active", "on_change": "event", "disabled": "internal" }
    for (const f of fields) {
      const current = f.getString("report_mode")
      const next = remap[current]
      if (next) {
        f.set("report_mode", next)
        app.save(f)
      }
    }
  }
)
