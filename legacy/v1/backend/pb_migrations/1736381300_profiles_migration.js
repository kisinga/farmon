// Profile-driven device architecture: creates 7 new profile collections,
// modifies devices (add profile/config fields, remove registration fields),
// drops device_schemas and firmware_history.

migrate((app) => {
  const empty = ""

  // 1. device_profiles — core metadata
  const profiles = new Collection({
    name: "device_profiles",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "profile_type", type: "text", required: true },
      { name: "is_template", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_device_profiles_name ON device_profiles (name)",
    ],
  })
  app.save(profiles)

  const profilesId = app.findCollectionByNameOrId("device_profiles").id

  // 2. profile_fields — one record per field
  const fields = new Collection({
    name: "profile_fields",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "key", type: "text", required: true },
      { name: "display_name", type: "text", required: true },
      { name: "unit", type: "text" },
      { name: "data_type", type: "text" },
      { name: "category", type: "text" },
      { name: "access", type: "text" },
      { name: "state_class", type: "text" },
      { name: "min_value", type: "number" },
      { name: "max_value", type: "number" },
      { name: "enum_values", type: "json" },
      { name: "sort_order", type: "number" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_profile_fields_profile_key ON profile_fields (profile, `key`)",
      "CREATE INDEX idx_profile_fields_sort ON profile_fields (profile, sort_order)",
    ],
  })
  app.save(fields)

  // 3. profile_controls — one record per control
  const controls = new Collection({
    name: "profile_controls",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "key", type: "text", required: true },
      { name: "display_name", type: "text", required: true },
      { name: "states", type: "json", required: true },
      { name: "sort_order", type: "number" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_profile_controls_profile_key ON profile_controls (profile, `key`)",
    ],
  })
  app.save(controls)

  // 4. profile_commands — one record per command
  const commands = new Collection({
    name: "profile_commands",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "name", type: "text", required: true },
      { name: "fport", type: "number", required: true },
      { name: "payload_type", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_profile_commands_profile_name ON profile_commands (profile, name)",
    ],
  })
  app.save(commands)

  // 5. decode_rules — one record per fPort decode rule
  const decodeRules = new Collection({
    name: "decode_rules",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "fport", type: "number", required: true },
      { name: "format", type: "text", required: true },
      { name: "config", type: "json", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_decode_rules_profile_fport ON decode_rules (profile, fport)",
    ],
  })
  app.save(decodeRules)

  // 6. profile_airconfig — hardware configuration (airconfig type only)
  const airconfig = new Collection({
    name: "profile_airconfig",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "pin_map", type: "json", required: true },
      { name: "sensors", type: "json", required: true },
      { name: "controls", type: "json", required: true },
      { name: "lorawan", type: "json", required: true },
      { name: "config_hash", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_profile_airconfig_profile ON profile_airconfig (profile)",
    ],
  })
  app.save(airconfig)

  // 7. profile_visualizations — how to display telemetry
  const visualizations = new Collection({
    name: "profile_visualizations",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "profile", type: "relation", required: true, collectionId: profilesId, maxSelect: 1, cascadeDelete: true },
      { name: "name", type: "text", required: true },
      { name: "viz_type", type: "text", required: true },
      { name: "config", type: "json", required: true },
      { name: "sort_order", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_profile_visualizations_sort ON profile_visualizations (profile, sort_order)",
    ],
  })
  app.save(visualizations)

  // 8. Modify devices: add profile/config fields, remove registration fields
  const devColl = app.findCollectionByNameOrId("devices")
  devColl.fields.add(new Field({ name: "profile", type: "relation", collectionId: profilesId, maxSelect: 1 }))
  devColl.fields.add(new Field({ name: "config_overrides", type: "json" }))
  devColl.fields.add(new Field({ name: "config_hash", type: "text" }))
  devColl.fields.add(new Field({ name: "config_status", type: "text" }))
  devColl.fields.removeByName("registration")
  devColl.fields.removeByName("registered_at")
  devColl.fields.removeByName("schema_version")
  devColl.fields.removeByName("commands_json")
  app.save(devColl)

  // 9. Drop obsolete collections
  try {
    const deviceSchemas = app.findCollectionByNameOrId("device_schemas")
    app.delete(deviceSchemas)
  } catch (_) {}
  try {
    const firmwareHistory = app.findCollectionByNameOrId("firmware_history")
    app.delete(firmwareHistory)
  } catch (_) {}

}, (app) => {
  // Rollback: drop 7 new collections, restore devices fields, recreate dropped collections

  const newColls = [
    "profile_visualizations", "profile_airconfig", "decode_rules",
    "profile_commands", "profile_controls", "profile_fields", "device_profiles",
  ]
  // First remove profile relation from devices before deleting device_profiles
  try {
    const devColl = app.findCollectionByNameOrId("devices")
    devColl.fields.removeByName("profile")
    devColl.fields.removeByName("config_overrides")
    devColl.fields.removeByName("config_hash")
    devColl.fields.removeByName("config_status")
    devColl.fields.add(new Field({ name: "registration", type: "json" }))
    devColl.fields.add(new Field({ name: "registered_at", type: "date" }))
    devColl.fields.add(new Field({ name: "schema_version", type: "number" }))
    devColl.fields.add(new Field({ name: "commands_json", type: "json" }))
    app.save(devColl)
  } catch (_) {}

  for (const name of newColls) {
    try {
      const coll = app.findCollectionByNameOrId(name)
      app.delete(coll)
    } catch (_) {}
  }

  // Recreate dropped collections (empty)
  const empty = ""
  const deviceSchemas = new Collection({
    name: "device_schemas",
    type: "base",
    listRule: empty,
    viewRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "version", type: "number", required: true },
      { name: "schema", type: "json", required: true },
      { name: "created_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_device_schemas_device_eui ON device_schemas (device_eui)"],
  })
  app.save(deviceSchemas)

  const firmwareHistory = new Collection({
    name: "firmware_history",
    type: "base",
    listRule: empty,
    viewRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "started_at", type: "date" },
      { name: "finished_at", type: "date" },
      { name: "outcome", type: "text", required: true },
      { name: "firmware_version", type: "text" },
      { name: "total_chunks", type: "number" },
      { name: "chunks_received", type: "number" },
      { name: "error_message", type: "text" },
      { name: "error_chunk_index", type: "number" },
    ],
    indexes: ["CREATE INDEX idx_firmware_history_device_eui ON firmware_history (device_eui)"],
  })
  app.save(firmwareHistory)
})
