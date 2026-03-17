// Enhanced edge rules: compound conditions (AND/OR second field or control state),
// time-of-day windows, and logic operators. Extends the 12-byte v1 rule to 16-byte v2.

migrate((app) => {
  try {
    const coll = app.findCollectionByNameOrId("device_rules")
    const fields = [
      { name: "second_field_idx", type: "number" },
      { name: "second_operator", type: "text" },
      { name: "second_threshold", type: "number" },
      { name: "second_is_control", type: "bool" },
      { name: "logic", type: "text" },
      { name: "time_start", type: "number" },
      { name: "time_end", type: "number" },
    ]
    for (const f of fields) {
      coll.fields.add(new Field(f))
    }
    app.save(coll)
  } catch (e) {
    console.log("enhanced_rules migration: " + e)
  }
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("device_rules")
    for (const name of ["second_field_idx", "second_operator", "second_threshold", "second_is_control", "logic", "time_start", "time_end"]) {
      const f = coll.fields.getByName(name)
      if (f) coll.fields.removeById(f.id)
    }
    app.save(coll)
  } catch (_) {}
})
