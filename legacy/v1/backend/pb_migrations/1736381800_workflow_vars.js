// workflow_vars: persistent key/value store shared across workflows.
// Supports optional TTL (expires_at) for counter-style patterns like
// "pump ran N times today" or "alert sent once per hour".

migrate((app) => {
  try {
    const coll = new Collection({
      name: "workflow_vars",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "key",        type: "text",   required: true },
        { name: "value",      type: "text",   required: true },
        { name: "expires_at", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_workflow_vars_key ON workflow_vars (key)",
      ],
    })
    app.save(coll)
  } catch (e) {
    console.log("workflow_vars migration: " + e)
  }
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("workflow_vars")
    app.delete(coll)
  } catch (_) {}
})
