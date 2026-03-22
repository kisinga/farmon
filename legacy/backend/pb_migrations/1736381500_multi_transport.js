// Multi-transport support: add transport/target fields to devices, create pending_commands collection.
// Enables WiFi devices alongside LoRaWAN. Existing devices default to transport="lorawan".

migrate((app) => {
  // Add transport fields to devices collection
  try {
    const devices = app.findCollectionByNameOrId("devices")
    devices.fields.add(new Field({
      name: "transport",
      type: "text",
    }))
    devices.fields.add(new Field({
      name: "device_token",
      type: "text",
    }))
    devices.fields.add(new Field({
      name: "target_id",
      type: "text",
    }))
    devices.indexes = devices.indexes || []
    devices.indexes.push("CREATE INDEX idx_devices_device_token ON devices (device_token)")
    devices.indexes.push("CREATE INDEX idx_devices_transport ON devices (transport)")
    app.save(devices)
  } catch (e) {
    console.log("multi_transport devices migration: " + e)
  }

  // Backfill existing devices with transport="lorawan"
  try {
    const records = app.findRecordsByFilter("devices", "transport = '' OR transport IS NULL", "", 0, 0)
    for (const rec of records) {
      rec.set("transport", "lorawan")
      app.save(rec)
    }
  } catch (e) {
    console.log("multi_transport backfill: " + e)
  }

  // Create pending_commands collection for WiFi downlink queue
  try {
    app.findCollectionByNameOrId("pending_commands")
    return // already exists
  } catch (_) {}

  const empty = ""
  const pendingCmds = new Collection({
    type: "base",
    name: "pending_commands",
    listRule: empty,
    viewRule: empty,
    fields: [
      { name: "device_eui", type: "text", required: true },
      { name: "command_key", type: "text" },
      { name: "fport", type: "number", required: true },
      { name: "payload_hex", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "expires_at", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_pending_commands_device_eui ON pending_commands (device_eui)",
      "CREATE INDEX idx_pending_commands_status ON pending_commands (status)",
    ],
  })
  app.save(pendingCmds)
}, (app) => {
  // Rollback: remove fields from devices, drop pending_commands
  try {
    const devices = app.findCollectionByNameOrId("devices")
    for (const name of ["transport", "device_token", "target_id"]) {
      const field = devices.fields.getByName(name)
      if (field) devices.fields.removeById(field.id)
    }
    app.save(devices)
  } catch (_) {}

  try {
    const coll = app.findCollectionByNameOrId("pending_commands")
    app.delete(coll)
  } catch (_) {}
})
