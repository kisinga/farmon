// Add affected_devices JSON field to workflow_log so we can query workflow events
// by any device they impacted (not just the trigger device).

migrate((app) => {
  const workflowLog = app.findCollectionByNameOrId("workflow_log")

  // Add affected_devices: JSON array of device EUIs touched by the workflow's actions.
  workflowLog.fields.add(new Field({
    name: "affected_devices",
    type: "json",
  }))

  // Index for fast lookups: "show me all workflow events that affected device X"
  workflowLog.indexes.push(
    "CREATE INDEX idx_workflow_log_affected ON workflow_log (affected_devices)"
  )

  app.save(workflowLog)
}, (app) => {
  const workflowLog = app.findCollectionByNameOrId("workflow_log")
  workflowLog.fields.removeByName("affected_devices")
  workflowLog.indexes = workflowLog.indexes.filter(
    (idx) => !idx.includes("idx_workflow_log_affected")
  )
  app.save(workflowLog)
})
