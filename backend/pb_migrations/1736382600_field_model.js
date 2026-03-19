/// <reference path="../pb_data/types.d.ts" />

// Migration: Unified field model
// - device_fields gains linkage tracking (linked_type, linked_key, report_mode)
// - device_controls gains hardware metadata (control_type, field_key, pin, actuator, etc.)
// - device_controls drops current_state (state now lives in linked field)
// - device_rules renames control_idx → target_field_idx, action_state → action_value

migrate(
  (app) => {
    // ── device_fields: add linkage columns ──
    const dfColl = app.findCollectionByNameOrId("device_fields")
    dfColl.fields.add(new Field({ name: "linked_type", type: "text" }))       // "input" | "output" | "compute" | null
    dfColl.fields.add(new Field({ name: "linked_key", type: "text" }))        // control_key, sensor ref, or compute id
    dfColl.fields.add(new Field({ name: "report_mode", type: "text" }))       // "active" | "event" | "internal"
    app.save(dfColl)

    // Set defaults: all existing fields are input/active
    const existingFields = app.findRecordsByFilter("device_fields", "1=1", "", 0, 0)
    for (const f of existingFields) {
      f.set("linked_type", "input")
      f.set("report_mode", "active")
      app.save(f)
    }

    // ── device_controls: add hardware metadata ──
    const dcColl = app.findCollectionByNameOrId("device_controls")
    dcColl.fields.add(new Field({ name: "control_type", type: "text" }))     // "binary" | "multistate" | "analog"
    dcColl.fields.add(new Field({ name: "field_key", type: "text" }))        // linked field key
    dcColl.fields.add(new Field({ name: "pin_index", type: "number" }))
    dcColl.fields.add(new Field({ name: "pin2_index", type: "number" }))
    dcColl.fields.add(new Field({ name: "actuator_type", type: "number" }))
    dcColl.fields.add(new Field({ name: "flags", type: "number" }))
    dcColl.fields.add(new Field({ name: "pulse_x100ms", type: "number" }))
    dcColl.fields.add(new Field({ name: "min_value", type: "number" }))
    dcColl.fields.add(new Field({ name: "max_value", type: "number" }))
    dcColl.fields.add(new Field({ name: "bus_index", type: "number" }))
    dcColl.fields.add(new Field({ name: "bus_address", type: "number" }))
    dcColl.fields.add(new Field({ name: "bus_channel", type: "number" }))

    // Remove current_state — state now lives in linked field
    dcColl.fields.removeByName("current_state")
    app.save(dcColl)

    // Set defaults on existing controls and auto-create linked fields
    const existingControls = app.findRecordsByFilter("device_controls", "1=1", "", 0, 0)
    const fieldsColl = app.findCollectionByNameOrId("device_fields")

    for (const c of existingControls) {
      c.set("control_type", "binary")
      c.set("pin2_index", 255)
      c.set("bus_index", -1)
      app.save(c)

      // Auto-create linked feedback field
      const eui = c.getString("device_eui")
      const ctrlKey = c.getString("control_key")
      const fieldKey = ctrlKey + "_state"

      // Check if field already exists
      try {
        app.findFirstRecordByFilter("device_fields",
          "device_eui = {:eui} && field_key = {:fk}", { eui: eui, fk: fieldKey })
      } catch {
        // Field doesn't exist, create it
        const fr = new Record(fieldsColl)
        fr.set("device_eui", eui)
        fr.set("field_key", fieldKey)
        fr.set("display_name", c.getString("display_name") || ctrlKey)
        fr.set("data_type", "number")
        fr.set("unit", "")
        fr.set("category", "control")
        fr.set("access", "rw")
        fr.set("min_value", 0)
        fr.set("max_value", 1)
        fr.set("linked_type", "output")
        fr.set("linked_key", ctrlKey)
        fr.set("report_mode", "event")
        app.save(fr)
      }

      c.set("field_key", fieldKey)
      app.save(c)
    }

    // ── device_rules: rename columns ──
    const drColl = app.findCollectionByNameOrId("device_rules")
    // Add new columns
    drColl.fields.add(new Field({ name: "target_field_idx", type: "number" }))
    drColl.fields.add(new Field({ name: "action_value", type: "number" }))
    app.save(drColl)

    // Copy values from old columns
    const existingRules = app.findRecordsByFilter("device_rules", "1=1", "", 0, 0)
    for (const r of existingRules) {
      r.set("target_field_idx", r.getFloat("control_idx"))
      r.set("action_value", r.getFloat("action_state"))
      app.save(r)
    }

    // Remove old columns
    drColl.fields.removeByName("control_idx")
    drColl.fields.removeByName("action_state")
    app.save(drColl)
  },

  (app) => {
    // Revert: remove new columns, restore old ones
    const dfColl = app.findCollectionByNameOrId("device_fields")
    dfColl.fields.removeByName("linked_type")
    dfColl.fields.removeByName("linked_key")
    dfColl.fields.removeByName("report_mode")
    app.save(dfColl)

    const dcColl = app.findCollectionByNameOrId("device_controls")
    dcColl.fields.add(new Field({ name: "current_state", type: "text" }))
    dcColl.fields.removeByName("control_type")
    dcColl.fields.removeByName("field_key")
    dcColl.fields.removeByName("pin_index")
    dcColl.fields.removeByName("pin2_index")
    dcColl.fields.removeByName("actuator_type")
    dcColl.fields.removeByName("flags")
    dcColl.fields.removeByName("pulse_x100ms")
    dcColl.fields.removeByName("min_value")
    dcColl.fields.removeByName("max_value")
    dcColl.fields.removeByName("bus_index")
    dcColl.fields.removeByName("bus_address")
    dcColl.fields.removeByName("bus_channel")
    app.save(dcColl)

    const drColl = app.findCollectionByNameOrId("device_rules")
    drColl.fields.add(new Field({ name: "control_idx", type: "number", required: true }))
    drColl.fields.add(new Field({ name: "action_state", type: "number", required: true }))
    drColl.fields.removeByName("target_field_idx")
    drColl.fields.removeByName("action_value")
    app.save(drColl)
  }
)
