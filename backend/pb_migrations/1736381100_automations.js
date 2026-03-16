// Create automations and automation_log collections for server-side automation engine.

migrate((app) => {
  // automations — rule definitions
  const automations = new Collection({
    name: "automations",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "enabled", type: "bool" },
      { name: "trigger_type", type: "text", required: true },
      { name: "trigger_device", type: "text" },
      { name: "condition_expr", type: "text", required: true },
      { name: "action_type", type: "text", required: true },
      { name: "action_config", type: "json", required: true },
      { name: "cooldown_seconds", type: "number" },
      { name: "priority", type: "number" },
      { name: "description", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_automations_trigger ON automations (trigger_type, trigger_device)",
      "CREATE INDEX idx_automations_enabled ON automations (enabled)",
    ],
  })
  app.save(automations)

  // automation_log — evaluation results
  const automationLog = new Collection({
    name: "automation_log",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    fields: [
      { name: "automation_id", type: "text", required: true },
      { name: "automation_name", type: "text" },
      { name: "trigger_device", type: "text" },
      { name: "trigger_type", type: "text" },
      { name: "condition_result", type: "bool" },
      { name: "status", type: "text", required: true },
      { name: "error_message", type: "text" },
      { name: "context_snapshot", type: "json" },
      { name: "ts", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_automation_log_automation_id ON automation_log (automation_id)",
      "CREATE INDEX idx_automation_log_ts ON automation_log (ts)",
    ],
  })
  app.save(automationLog)
}, (app) => {
  const automationLog = app.findCollectionByNameOrId("automation_log")
  app.delete(automationLog)
  const automations = app.findCollectionByNameOrId("automations")
  app.delete(automations)
})
