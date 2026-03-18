// Add decoded_json text field to lorawan_frames for storing decoded payload alongside raw hex.

migrate((app) => {
  try {
    const coll = app.findCollectionByNameOrId("lorawan_frames")
    coll.fields.add(new Field({ name: "decoded_json", type: "text" }))
    app.save(coll)
  } catch (e) {
    console.log("add_decoded_json migration: " + e)
  }
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("lorawan_frames")
    const f = coll.fields.getByName("decoded_json")
    if (f) coll.fields.removeById(f.id)
    app.save(coll)
  } catch (_) {}
})
