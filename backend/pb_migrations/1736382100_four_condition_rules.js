// Four-condition rules (v4): replaces flat second_* columns with JSON extra_conditions array,
// adds window_active flag for server-side time window enforcement, and action_dur_x10s field.

migrate((app) => {
  try {
    const coll = app.findCollectionByNameOrId("device_rules")

    // extra_conditions: JSON array of up to 3 extra condition objects
    // Each entry: { field_idx, operator, threshold, is_control, logic }
    coll.fields.add(new Field({ name: "extra_conditions", type: "json" }))

    // window_active: server-managed flag for time window enforcement.
    // true = within active window (or no time window set). false = outside window.
    // Binary encoding uses: Enabled = enabled AND window_active.
    coll.fields.add(new Field({ name: "window_active", type: "bool" }))

    // action_dur_x10s: action duration in units of 10 seconds (0=hold indefinitely).
    // Previously this was corrupted by time window data in byte 15.
    coll.fields.add(new Field({ name: "action_dur_x10s", type: "number" }))

    // Remove legacy flat compound condition columns
    for (const name of ["second_field_idx", "second_operator", "second_threshold", "second_is_control", "logic"]) {
      const f = coll.fields.getByName(name)
      if (f) coll.fields.removeById(f.id)
    }

    app.save(coll)
  } catch (e) {
    console.log("four_condition_rules migration: " + e)
  }
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("device_rules")
    for (const name of ["extra_conditions", "window_active", "action_dur_x10s"]) {
      const f = coll.fields.getByName(name)
      if (f) coll.fields.removeById(f.id)
    }
    // Restore legacy columns
    coll.fields.add(new Field({ name: "second_field_idx", type: "number" }))
    coll.fields.add(new Field({ name: "second_operator", type: "text" }))
    coll.fields.add(new Field({ name: "second_threshold", type: "number" }))
    coll.fields.add(new Field({ name: "second_is_control", type: "bool" }))
    coll.fields.add(new Field({ name: "logic", type: "text" }))
    app.save(coll)
  } catch (_) {}
})
