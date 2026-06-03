// Add test_mode boolean field to gateway_settings collection.
// When enabled, the backend skips concentratord connections and accepts uplinks only via the test inject endpoint.

migrate((app) => {
  try {
    const collection = app.findCollectionByNameOrId("gateway_settings")
    collection.fields.add(new Field({
      name: "test_mode",
      type: "bool",
    }))
    app.save(collection)
  } catch (e) {
    // Field may already exist
    console.log("gateway_test_mode migration: " + e)
  }
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("gateway_settings")
    const field = collection.fields.getByName("test_mode")
    if (field) {
      collection.fields.removeById(field.id)
      app.save(collection)
    }
  } catch (_) {}
})
