/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId("devices")
    if (!coll.fields.getByName("hardware_model")) {
      coll.fields.add(new Field({ type: "text", name: "hardware_model" }))
      app.save(coll)
    }
  },
  (app) => {
    const coll = app.findCollectionByNameOrId("devices")
    const field = coll.fields.getByName("hardware_model")
    if (field) {
      coll.fields.removeById(field.id)
      app.save(coll)
    }
  }
)
