// Add registration-derived fields to device_fields, device_controls, and devices.
// These columns are populated when the backend processes fPort 1 registration frames.

migrate((app) => {
  // device_fields: add state_class, access, field_idx
  const dfColl = app.findCollectionByNameOrId("device_fields")
  dfColl.fields.add(new Field({ name: "state_class", type: "text" }))
  dfColl.fields.add(new Field({ name: "access", type: "text" }))
  dfColl.fields.add(new Field({ name: "field_idx", type: "number" }))
  app.save(dfColl)

  // device_controls: add display_name, states_json, control_idx
  const dcColl = app.findCollectionByNameOrId("device_controls")
  dcColl.fields.add(new Field({ name: "display_name", type: "text" }))
  dcColl.fields.add(new Field({ name: "states_json", type: "json" }))
  dcColl.fields.add(new Field({ name: "control_idx", type: "number" }))
  app.save(dcColl)

  // devices: add commands_json for storing command→fPort mapping from registration
  const devColl = app.findCollectionByNameOrId("devices")
  devColl.fields.add(new Field({ name: "commands_json", type: "json" }))
  app.save(devColl)
}, (app) => {
  // Rollback: remove added fields
  const dfColl = app.findCollectionByNameOrId("device_fields")
  dfColl.fields.removeByName("state_class")
  dfColl.fields.removeByName("access")
  dfColl.fields.removeByName("field_idx")
  app.save(dfColl)

  const dcColl = app.findCollectionByNameOrId("device_controls")
  dcColl.fields.removeByName("display_name")
  dcColl.fields.removeByName("states_json")
  dcColl.fields.removeByName("control_idx")
  app.save(dcColl)

  const devColl = app.findCollectionByNameOrId("devices")
  devColl.fields.removeByName("commands_json")
  app.save(devColl)
})
