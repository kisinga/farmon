// scheduled_actions: delayed workflow action steps.
// When a workflow action has delay_seconds > 0, the backend inserts a record here
// instead of executing immediately. The scheduler goroutine polls every 5s
// and executes due records.

migrate((app) => {
  try {
    const coll = new Collection({
      name: "scheduled_actions",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "workflow_id",      type: "text", required: true },
        { name: "action_json",      type: "json", required: true },
        { name: "trigger_ctx",      type: "json" },
        { name: "execute_at",       type: "date", required: true },
        { name: "status",           type: "text", required: true }, // pending | done | failed
        { name: "error_message",    type: "text" },
      ],
      indexes: [
        "CREATE INDEX idx_scheduled_actions_pending ON scheduled_actions (status, execute_at)",
      ],
    })
    app.save(coll)
  } catch (e) {
    console.log("scheduled_actions migration: " + e)
  }
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("scheduled_actions")
    app.delete(coll)
  } catch (_) {}
})
