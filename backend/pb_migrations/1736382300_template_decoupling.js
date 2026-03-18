// Template decoupling: create device-level collections for airconfig, decode_rules,
// commands, and visualizations. Migrate existing device data from profiles to device level.
// Add provisioned_from to devices. Rename device_profiles → device_templates.

migrate((app) => {
  const empty = ""

  // 1. device_airconfig — per-device hardware configuration
  const deviceAirconfig = new Collection({
    name: "device_airconfig",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "pin_map", type: "json" },
      { name: "sensors", type: "json" },
      { name: "controls", type: "json" },
      { name: "lorawan", type: "json" },
      { name: "transfer", type: "json" },
      { name: "config_hash", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_device_airconfig_eui ON device_airconfig (device_eui)",
    ],
  })
  app.save(deviceAirconfig)

  // 2. device_decode_rules — per-device decode rules
  const deviceDecodeRules = new Collection({
    name: "device_decode_rules",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "fport", type: "number", required: true },
      { name: "format", type: "text", required: true },
      { name: "config", type: "json", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_device_decode_rules_eui_fport ON device_decode_rules (device_eui, fport)",
    ],
  })
  app.save(deviceDecodeRules)

  // 3. device_commands — per-device command definitions
  const deviceCommands = new Collection({
    name: "device_commands",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "name", type: "text", required: true },
      { name: "fport", type: "number", required: true },
      { name: "payload_type", type: "text" },
      { name: "delivery", type: "text" },
      { name: "command_key", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_device_commands_eui_name ON device_commands (device_eui, name)",
    ],
  })
  app.save(deviceCommands)

  // 4. device_visualizations — per-device display configuration
  const deviceVisualizations = new Collection({
    name: "device_visualizations",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "name", type: "text", required: true },
      { name: "viz_type", type: "text", required: true },
      { name: "config", type: "json", required: true },
      { name: "sort_order", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_device_visualizations_eui_sort ON device_visualizations (device_eui, sort_order)",
    ],
  })
  app.save(deviceVisualizations)

  // 5. Add provisioned_from to devices
  const devColl = app.findCollectionByNameOrId("devices")
  devColl.fields.add(new Field({ name: "provisioned_from", type: "text" }))
  app.save(devColl)

  // 6. Data migration: copy profile data to device-level collections for all provisioned devices
  const devices = app.findRecordsByFilter("devices", "profile != ''", "", 0, 0)
  for (const dev of devices) {
    const devEui = dev.getString("device_eui")
    const profileId = dev.getString("profile")
    if (!profileId) continue

    let profile
    try {
      profile = app.findRecordById("device_profiles", profileId)
    } catch (_) {
      continue // profile deleted, skip
    }

    const profileType = profile.getString("profile_type")

    // Set device_type and provisioned_from
    dev.set("device_type", profileType)
    dev.set("provisioned_from", profileId)
    app.save(dev)

    // Migrate airconfig (apply config_overrides if present)
    if (profileType === "airconfig") {
      try {
        const ac = app.findFirstRecordByFilter("profile_airconfig", "profile = {:pid}", { pid: profileId })
        if (ac) {
          let pinMap = ac.get("pin_map")
          let sensors = ac.get("sensors")
          let controls = ac.get("controls")
          let lorawan = ac.get("lorawan")
          let transfer = ac.get("transfer") || null

          // Apply config_overrides if present
          const overridesRaw = dev.getString("config_overrides")
          if (overridesRaw && overridesRaw !== "null" && overridesRaw !== "") {
            try {
              const overrides = JSON.parse(overridesRaw)
              if (overrides.pin_map) pinMap = overrides.pin_map
              if (overrides.sensors) sensors = overrides.sensors
              if (overrides.controls) controls = overrides.controls
              if (overrides.transfer) transfer = overrides.transfer
              if (overrides.lorawan) {
                // Merge lorawan fields
                try {
                  const baseLora = typeof lorawan === "string" ? JSON.parse(lorawan) : (lorawan || {})
                  const overLora = typeof overrides.lorawan === "string" ? JSON.parse(overrides.lorawan) : overrides.lorawan
                  Object.assign(baseLora, overLora)
                  lorawan = baseLora
                } catch (_) {
                  lorawan = overrides.lorawan
                }
              }
            } catch (_) {
              // ignore invalid overrides
            }
          }

          const dacColl = app.findCollectionByNameOrId("device_airconfig")
          const dacRec = new Record(dacColl)
          dacRec.set("device_eui", devEui)
          dacRec.set("pin_map", pinMap)
          dacRec.set("sensors", sensors)
          dacRec.set("controls", controls)
          dacRec.set("lorawan", lorawan)
          dacRec.set("transfer", transfer)
          dacRec.set("config_hash", ac.getString("config_hash") || "")
          app.save(dacRec)
        }
      } catch (_) {}
    }

    // Migrate decode rules
    try {
      const rules = app.findRecordsByFilter("decode_rules", "profile = {:pid}", "", 0, 0, { pid: profileId })
      const ddrColl = app.findCollectionByNameOrId("device_decode_rules")
      for (const rule of rules) {
        const rec = new Record(ddrColl)
        rec.set("device_eui", devEui)
        rec.set("fport", rule.getInt("fport"))
        rec.set("format", rule.getString("format"))
        rec.set("config", rule.get("config"))
        app.save(rec)
      }
    } catch (_) {}

    // For airconfig devices, add synthetic decode rules if not already present
    if (profileType === "airconfig") {
      const ddrColl = app.findCollectionByNameOrId("device_decode_rules")
      const syntheticRules = [
        { fport: 2, format: "binary_indexed_float32", config: {} },
        { fport: 3, format: "binary_state_change", config: {
          record_size: 11,
          layout: [
            { offset: 0, name: "control_idx", type: "uint8" },
            { offset: 1, name: "new_state", type: "uint8" },
            { offset: 2, name: "old_state", type: "uint8" },
            { offset: 3, name: "source_id", type: "uint8" },
            { offset: 4, name: "rule_id", type: "uint8" },
            { offset: 5, name: "device_ms", type: "uint32_le" },
            { offset: 9, name: "seq", type: "uint16_le" },
          ],
          source_map: { "0": "BOOT", "1": "RULE", "2": "MANUAL", "3": "DOWNLINK" },
        }},
        { fport: 4, format: "text_kv", config: { separator: ":", kv_separator: ":" } },
      ]
      for (const sr of syntheticRules) {
        try {
          // Skip if explicit rule already exists for this fport
          app.findFirstRecordByFilter("device_decode_rules",
            "device_eui = {:eui} && fport = {:fp}", { eui: devEui, fp: sr.fport })
        } catch (_) {
          // Not found — create synthetic rule
          const rec = new Record(ddrColl)
          rec.set("device_eui", devEui)
          rec.set("fport", sr.fport)
          rec.set("format", sr.format)
          rec.set("config", sr.config)
          try { app.save(rec) } catch (_) {}
        }
      }
    }

    // Migrate commands
    try {
      const cmds = app.findRecordsByFilter("profile_commands", "profile = {:pid}", "", 0, 0, { pid: profileId })
      const dcColl = app.findCollectionByNameOrId("device_commands")
      for (const cmd of cmds) {
        const rec = new Record(dcColl)
        rec.set("device_eui", devEui)
        rec.set("name", cmd.getString("name"))
        rec.set("fport", cmd.getInt("fport"))
        rec.set("payload_type", cmd.getString("payload_type"))
        rec.set("delivery", cmd.getString("delivery"))
        rec.set("command_key", cmd.getString("command_key"))
        app.save(rec)
      }
    } catch (_) {}

    // Migrate visualizations
    try {
      const vizs = app.findRecordsByFilter("profile_visualizations", "profile = {:pid}", "", 0, 0, { pid: profileId })
      const dvColl = app.findCollectionByNameOrId("device_visualizations")
      for (const viz of vizs) {
        const rec = new Record(dvColl)
        rec.set("device_eui", devEui)
        rec.set("name", viz.getString("name"))
        rec.set("viz_type", viz.getString("viz_type"))
        rec.set("config", viz.get("config"))
        rec.set("sort_order", viz.getInt("sort_order"))
        app.save(rec)
      }
    } catch (_) {}
  }

  // 7. Rename device_profiles → device_templates
  const profilesColl = app.findCollectionByNameOrId("device_profiles")
  profilesColl.name = "device_templates"
  app.save(profilesColl)

}, (app) => {
  // Rollback: rename back, remove new collections, remove provisioned_from

  // Rename back
  try {
    const templatesColl = app.findCollectionByNameOrId("device_templates")
    templatesColl.name = "device_profiles"
    app.save(templatesColl)
  } catch (_) {}

  // Remove provisioned_from from devices
  try {
    const devColl = app.findCollectionByNameOrId("devices")
    devColl.fields.removeByName("provisioned_from")
    app.save(devColl)
  } catch (_) {}

  // Drop new collections
  const newColls = ["device_visualizations", "device_commands", "device_decode_rules", "device_airconfig"]
  for (const name of newColls) {
    try {
      const coll = app.findCollectionByNameOrId(name)
      app.delete(coll)
    } catch (_) {}
  }
})
