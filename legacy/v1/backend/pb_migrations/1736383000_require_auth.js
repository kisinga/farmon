// Restrict all collection access to authenticated users.
// Sets listRule, viewRule, createRule, updateRule to "@request.auth.id != \"\"" on all active collections.
// deleteRule is left unchanged (null = admin-only) on all collections.

const AUTH_RULE = '@request.auth.id != ""'

// Collections that already had createRule/updateRule set (non-null) before this migration.
// All others had null for those rules; we only set list/view for those.
const FULL_RW_COLLECTIONS = [
  "device_rules",
  "gateway_settings",
  "wifi_settings",
  "workflows",
  "workflow_log",
  "workflow_vars",
  "scheduled_actions",
  "lorawan_frames",
  "pending_commands",
  "device_airconfig",
  "device_decode_rules",
  "device_commands",
  "device_visualizations",
]

// Collections where createRule/updateRule were null (admin-only) — only lock list/view.
const READ_ONLY_COLLECTIONS = [
  "devices",
  "telemetry",
  "device_controls",
  "state_changes",
  "commands",
  "device_fields",
  "lorawan_sessions",
]

migrate(
  (app) => {
    for (const name of FULL_RW_COLLECTIONS) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = AUTH_RULE
        col.viewRule = AUTH_RULE
        col.createRule = AUTH_RULE
        col.updateRule = AUTH_RULE
        app.save(col)
      } catch (_) {}
    }
    for (const name of READ_ONLY_COLLECTIONS) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = AUTH_RULE
        col.viewRule = AUTH_RULE
        app.save(col)
      } catch (_) {}
    }
  },
  (app) => {
    for (const name of FULL_RW_COLLECTIONS) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = ""
        col.viewRule = ""
        col.createRule = ""
        col.updateRule = ""
        app.save(col)
      } catch (_) {}
    }
    for (const name of READ_ONLY_COLLECTIONS) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = ""
        col.viewRule = ""
        app.save(col)
      } catch (_) {}
    }
  }
)
