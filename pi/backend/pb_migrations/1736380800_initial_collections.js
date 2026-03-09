// Farmon initial collections: devices, telemetry, device_controls, state_changes,
// commands, firmware_history, edge_rules, device_fields, lorawan_sessions, device_schemas, gateway_settings.
// Public list/view (and edge_rules create/update) for now.

migrate((app) => {
  const empty = ""

  const collections = [
    {
      name: "devices",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "device_name", type: "text" },
        { name: "app_key", type: "text" },
        { name: "device_type", type: "text" },
        { name: "firmware_version", type: "text" },
        { name: "registration", type: "json" },
        { name: "first_seen", type: "date" },
        { name: "last_seen", type: "date" },
        { name: "is_active", type: "bool" },
      ],
    },
    {
      name: "telemetry",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "data", type: "json", required: true },
        { name: "rssi", type: "number" },
        { name: "snr", type: "number" },
        { name: "ts", type: "date" },
      ],
    },
    {
      name: "device_controls",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "control_key", type: "text", required: true },
        { name: "current_state", type: "text", required: true },
        { name: "mode", type: "text" },
        { name: "manual_until", type: "date" },
        { name: "last_change_at", type: "date" },
        { name: "last_change_by", type: "text" },
      ],
    },
    {
      name: "state_changes",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "control_key", type: "text", required: true },
        { name: "old_state", type: "text" },
        { name: "new_state", type: "text", required: true },
        { name: "reason", type: "text" },
        { name: "device_ts", type: "date" },
        { name: "ts", type: "date" },
      ],
    },
    {
      name: "commands",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "command_key", type: "text", required: true },
        { name: "payload", type: "json" },
        { name: "initiated_by", type: "text", required: true },
        { name: "status", type: "text" },
        { name: "sent_at", type: "date" },
        { name: "acked_at", type: "date" },
        { name: "created_at", type: "date" },
      ],
    },
    {
      name: "firmware_history",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "started_at", type: "date" },
        { name: "finished_at", type: "date" },
        { name: "outcome", type: "text", required: true },
        { name: "firmware_version", type: "text" },
        { name: "total_chunks", type: "number" },
        { name: "chunks_received", type: "number" },
        { name: "error_message", type: "text" },
        { name: "error_chunk_index", type: "number" },
      ],
    },
    {
      name: "edge_rules",
      listRule: empty,
      viewRule: empty,
      createRule: empty,
      updateRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "rule_id", type: "number", required: true },
        { name: "field_idx", type: "number", required: true },
        { name: "operator", type: "text", required: true },
        { name: "threshold", type: "number", required: true },
        { name: "control_idx", type: "number", required: true },
        { name: "action_state", type: "number", required: true },
        { name: "priority", type: "number" },
        { name: "cooldown_seconds", type: "number" },
        { name: "enabled", type: "bool" },
        { name: "synced_at", type: "date" },
      ],
    },
    {
      name: "device_fields",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "field_key", type: "text", required: true },
        { name: "display_name", type: "text", required: true },
        { name: "data_type", type: "text", required: true },
        { name: "unit", type: "text" },
        { name: "category", type: "text", required: true },
        { name: "min_value", type: "number" },
        { name: "max_value", type: "number" },
        { name: "enum_values", type: "json" },
      ],
    },
    {
      name: "lorawan_sessions",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "dev_addr_hex", type: "text", required: true },
        { name: "nwk_skey_hex", type: "text", required: true },
        { name: "app_skey_hex", type: "text", required: true },
        { name: "f_cnt_up", type: "number" },
        { name: "f_cnt_down", type: "number" },
      ],
    },
    {
      name: "device_schemas",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "device_eui", type: "text", required: true },
        { name: "version", type: "number", required: true },
        { name: "schema", type: "json", required: true },
        { name: "created_at", type: "date" },
      ],
    },
    {
      name: "gateway_settings",
      listRule: empty,
      viewRule: empty,
      fields: [
        { name: "region", type: "text" },
        { name: "event_url", type: "text" },
        { name: "command_url", type: "text" },
        { name: "gateway_id", type: "text" },
        { name: "rx1_delay", type: "number" },
        { name: "rx1_frequency_hz", type: "number" },
      ],
    },
  ]

  for (const config of collections) {
    const collection = new Collection({
      type: "base",
      name: config.name,
      listRule: config.listRule ?? null,
      viewRule: config.viewRule ?? null,
      createRule: config.createRule ?? null,
      updateRule: config.updateRule ?? null,
      fields: config.fields,
    })
    app.save(collection)
  }
}, (app) => {
  const names = [
    "devices",
    "telemetry",
    "device_controls",
    "state_changes",
    "commands",
    "firmware_history",
    "edge_rules",
    "device_fields",
    "lorawan_sessions",
    "device_schemas",
    "gateway_settings",
  ]
  for (const name of names) {
    try {
      const collection = app.findCollectionByNameOrId(name)
      app.delete(collection)
    } catch (_) {}
  }
})
