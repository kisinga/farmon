// Migrate automations → workflows, automation_log → workflow_log, edge_rules → device_rules.
// Transforms flat trigger_type/trigger_device/action_type/action_config into triggers[] and actions[] arrays.

migrate((app) => {
  const empty = ""

  // 1. Create workflows collection (new schema)
  const workflows = new Collection({
    name: "workflows",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "enabled", type: "bool" },
      { name: "priority", type: "number" },
      { name: "cooldown_seconds", type: "number" },
      { name: "triggers", type: "json", required: true },
      { name: "condition_expr", type: "text" },
      { name: "actions", type: "json", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_workflows_enabled ON workflows (enabled)",
    ],
  })
  app.save(workflows)

  // 2. Create workflow_log collection
  const workflowLog = new Collection({
    name: "workflow_log",
    type: "base",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "workflow_id", type: "text", required: true },
      { name: "workflow_name", type: "text" },
      { name: "trigger_device", type: "text" },
      { name: "trigger_type", type: "text" },
      { name: "trigger_index", type: "number" },
      { name: "condition_result", type: "bool" },
      { name: "actions_completed", type: "number" },
      { name: "status", type: "text", required: true },
      { name: "error_message", type: "text" },
      { name: "context_snapshot", type: "json" },
      { name: "ts", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_workflow_log_workflow_id ON workflow_log (workflow_id)",
      "CREATE INDEX idx_workflow_log_ts ON workflow_log (ts)",
    ],
  })
  app.save(workflowLog)

  // 3. Migrate existing automation records to workflows
  try {
    const automations = app.findRecordsByFilter("automations", "", "", 500, 0)
    const wfColl = app.findCollectionByNameOrId("workflows")
    for (const auto of automations) {
      const rec = new Record(wfColl)
      rec.set("name", auto.get("name") || "")
      rec.set("description", auto.get("description") || "")
      rec.set("enabled", auto.getBool("enabled"))
      rec.set("priority", auto.get("priority") || 0)
      rec.set("cooldown_seconds", auto.get("cooldown_seconds") || 0)

      // Convert flat trigger to triggers array
      const triggerType = auto.get("trigger_type") || "telemetry"
      const triggerDevice = auto.get("trigger_device") || ""
      const filter = {}
      if (triggerDevice) filter.device_eui = triggerDevice
      rec.set("triggers", JSON.stringify([{ type: triggerType, filter: filter }]))

      rec.set("condition_expr", auto.get("condition_expr") || "")

      // Convert flat action to actions array
      const actionType = auto.get("action_type") || ""
      let actionConfig = {}
      try {
        const raw = auto.get("action_config")
        actionConfig = typeof raw === "string" ? JSON.parse(raw) : (raw || {})
      } catch (_) {}
      rec.set("actions", JSON.stringify([{ type: actionType === "setControl" ? "set_control" : "send_command", ...actionConfig }]))

      app.save(rec)
    }
  } catch (_) {
    // automations collection may not exist yet
  }

  // 4. Migrate automation_log records to workflow_log
  try {
    const logs = app.findRecordsByFilter("automation_log", "", "", 500, 0)
    const logColl = app.findCollectionByNameOrId("workflow_log")
    for (const log of logs) {
      const rec = new Record(logColl)
      rec.set("workflow_id", log.get("automation_id") || "")
      rec.set("workflow_name", log.get("automation_name") || "")
      rec.set("trigger_device", log.get("trigger_device") || "")
      rec.set("trigger_type", log.get("trigger_type") || "")
      rec.set("trigger_index", 0)
      rec.set("condition_result", log.getBool("condition_result"))
      rec.set("actions_completed", 0)
      rec.set("status", log.get("status") || "")
      rec.set("error_message", log.get("error_message") || "")
      rec.set("context_snapshot", log.get("context_snapshot"))
      rec.set("ts", log.get("ts"))
      app.save(rec)
    }
  } catch (_) {
    // automation_log may not exist
  }

  // 5. Rename edge_rules → device_rules
  try {
    const edgeRules = app.findCollectionByNameOrId("edge_rules")
    edgeRules.name = "device_rules"
    // Update index names
    edgeRules.indexes = [
      "CREATE INDEX idx_device_rules_device_eui ON device_rules (device_eui)",
    ]
    app.save(edgeRules)
  } catch (_) {
    // edge_rules may not exist
  }

  // 6. Drop old collections
  try {
    const automationLog = app.findCollectionByNameOrId("automation_log")
    app.delete(automationLog)
  } catch (_) {}
  try {
    const automations = app.findCollectionByNameOrId("automations")
    app.delete(automations)
  } catch (_) {}

}, (app) => {
  // Rollback: recreate old collections, rename device_rules back
  // (data migration rollback is best-effort)
  try {
    const deviceRules = app.findCollectionByNameOrId("device_rules")
    deviceRules.name = "edge_rules"
    deviceRules.indexes = [
      "CREATE INDEX idx_edge_rules_device_eui ON edge_rules (device_eui)",
    ]
    app.save(deviceRules)
  } catch (_) {}

  try {
    const workflowLog = app.findCollectionByNameOrId("workflow_log")
    app.delete(workflowLog)
  } catch (_) {}
  try {
    const workflows = app.findCollectionByNameOrId("workflows")
    app.delete(workflows)
  } catch (_) {}

  // Recreate automations and automation_log (empty — data lost on rollback)
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
})
