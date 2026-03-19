/// <reference path="../pb_data/types.d.ts" />
// Fix: wifi_settings collection is missing enabled and test_mode columns.
// The original transport_enabled migration created the collection but the fields
// were not persisted (likely a JSVM constructor limitation). This migration adds
// them properly using fields.add(), matching how other migrations add fields.

migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId("wifi_settings")

    // Only add fields that are missing
    if (!coll.fields.getByName("enabled")) {
      coll.fields.add(new Field({ type: "bool", name: "enabled" }))
    }
    if (!coll.fields.getByName("test_mode")) {
      coll.fields.add(new Field({ type: "bool", name: "test_mode" }))
    }
    app.save(coll)

    // Backfill the existing record with defaults
    const records = app.findRecordsByFilter("wifi_settings", "1=1", "", 0, 0)
    for (const rec of records) {
      if (rec.get("enabled") === null || rec.get("enabled") === undefined) {
        rec.set("enabled", true)
      }
      if (rec.get("test_mode") === null || rec.get("test_mode") === undefined) {
        rec.set("test_mode", false)
      }
      app.save(rec)
    }
  },
  (app) => {
    const coll = app.findCollectionByNameOrId("wifi_settings")
    const enabled = coll.fields.getByName("enabled")
    const testMode = coll.fields.getByName("test_mode")
    if (enabled) coll.fields.removeById(enabled.id)
    if (testMode) coll.fields.removeById(testMode.id)
    app.save(coll)
  }
)
