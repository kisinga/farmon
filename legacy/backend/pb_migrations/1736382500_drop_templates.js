/// <reference path="../pb_data/types.d.ts" />
// Migration: Drop template collections and clean up devices collection.
// Templates are now external JSON artifacts — devices own their config directly.

migrate(
  (app) => {
    // Remove fields from devices collection that referenced templates
    const devices = app.findCollectionByNameOrId("devices");
    const fieldsToRemove = ["profile", "provisioned_from", "config_overrides", "target_id"];
    for (const fieldName of fieldsToRemove) {
      const field = devices.fields.find((f) => f.name === fieldName);
      if (field) {
        devices.fields.removeById(field.id);
      }
    }
    app.save(devices);

    // Drop template collections (order: children first to avoid FK issues)
    const collectionsToDrop = [
      "profile_fields",
      "profile_controls",
      "profile_commands",
      "decode_rules",
      "profile_airconfig",
      "profile_visualizations",
      "device_templates",
    ];
    for (const name of collectionsToDrop) {
      try {
        const coll = app.findCollectionByNameOrId(name);
        app.delete(coll);
      } catch (e) {
        // Collection may not exist — skip
      }
    }
  },
  (app) => {
    // Down migration: not supported for this breaking change
  }
);
