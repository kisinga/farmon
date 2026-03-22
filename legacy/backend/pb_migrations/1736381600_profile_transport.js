// Profile transport awareness: transport field on profiles, delivery/command_key on commands,
// payload_json on pending_commands. Backfills airconfig profiles as LoRaWAN.

migrate((app) => {
  // 1. Add transport to device_profiles
  try {
    const profiles = app.findCollectionByNameOrId("device_profiles")
    profiles.fields.add(new Field({ name: "transport", type: "text" }))
    app.save(profiles)
  } catch (e) {
    console.log("profile_transport: profiles field: " + e)
  }

  // 2. Add delivery + command_key to profile_commands
  try {
    const cmds = app.findCollectionByNameOrId("profile_commands")
    cmds.fields.add(new Field({ name: "delivery", type: "text" }))
    cmds.fields.add(new Field({ name: "command_key", type: "text" }))
    app.save(cmds)
  } catch (e) {
    console.log("profile_transport: commands fields: " + e)
  }

  // 3. Add payload_json to pending_commands
  try {
    const pending = app.findCollectionByNameOrId("pending_commands")
    pending.fields.add(new Field({ name: "payload_json", type: "json" }))
    app.save(pending)
  } catch (e) {
    console.log("profile_transport: pending_commands field: " + e)
  }

  // 4. Backfill: existing airconfig profiles are all LoRaWAN (LoRa-E5 based).
  // New airconfig profiles are NOT locked to LoRaWAN — transport is independent of profile_type.
  try {
    const records = app.findRecordsByFilter("device_profiles", "profile_type = 'airconfig' AND (transport = '' OR transport IS NULL)", "", 0, 0)
    for (const rec of records) {
      rec.set("transport", "lorawan")
      app.save(rec)
    }
  } catch (e) {
    console.log("profile_transport: backfill profiles: " + e)
  }

  // 5. Backfill: devices without transport → "lorawan"
  try {
    const records = app.findRecordsByFilter("devices", "transport = '' OR transport IS NULL", "", 0, 0)
    for (const rec of records) {
      rec.set("transport", "lorawan")
      app.save(rec)
    }
  } catch (e) {
    console.log("profile_transport: backfill devices: " + e)
  }
}, (app) => {
  // Rollback
  try {
    const profiles = app.findCollectionByNameOrId("device_profiles")
    const f = profiles.fields.getByName("transport")
    if (f) { profiles.fields.removeById(f.id); app.save(profiles) }
  } catch (_) {}

  try {
    const cmds = app.findCollectionByNameOrId("profile_commands")
    for (const name of ["delivery", "command_key"]) {
      const f = cmds.fields.getByName(name)
      if (f) cmds.fields.removeById(f.id)
    }
    app.save(cmds)
  } catch (_) {}

  try {
    const pending = app.findCollectionByNameOrId("pending_commands")
    const f = pending.fields.getByName("payload_json")
    if (f) { pending.fields.removeById(f.id); app.save(pending) }
  } catch (_) {}
})
