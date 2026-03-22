// Add enabled field to gateway_settings and create wifi_settings collection.

migrate(
  (app) => {
    // --- Add enabled (bool, default true) to gateway_settings ---
    const gw = app.findCollectionByNameOrId("gateway_settings")
    gw.fields.add(
      new Field({
        type: "bool",
        name: "enabled",
      })
    )
    app.save(gw)

    // Set enabled=true on existing records so behaviour is unchanged
    const gwRecords = app.findRecordsByFilter("gateway_settings", "", "", 0, 0)
    for (const rec of gwRecords) {
      rec.set("enabled", true)
      app.save(rec)
    }

    // --- Create wifi_settings collection (public access, same as gateway_settings) ---
    const wifi = new Collection({
      name: "wifi_settings",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      fields: [
        new Field({ type: "bool", name: "enabled" }),
        new Field({ type: "bool", name: "test_mode" }),
      ],
    })
    app.save(wifi)
  },
  (app) => {
    // Revert: remove enabled from gateway_settings, drop wifi_settings
    try {
      const gw = app.findCollectionByNameOrId("gateway_settings")
      gw.fields.removeByName("enabled")
      app.save(gw)
    } catch (_) {}

    try {
      const wifi = app.findCollectionByNameOrId("wifi_settings")
      app.delete(wifi)
    } catch (_) {}
  }
)
