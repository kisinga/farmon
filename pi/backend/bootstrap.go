package main

import (
	"log"

	"github.com/pocketbase/pocketbase/core"
)

// setPublicListAndViewRules allows unauthenticated list and view access (no auth for now).
func setPublicListAndViewRules(coll *core.Collection) {
	empty := ""
	coll.ListRule = &empty
	coll.ViewRule = &empty
}

func bootstrapCollections(app core.App) {
	// devices
	if _, err := app.FindCollectionByNameOrId("devices"); err != nil {
		coll := core.NewBaseCollection("devices")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "device_name"})
		coll.Fields.Add(&core.TextField{Name: "app_key"}) // LoRaWAN OTAA AppKey (hex, 32 chars)
		coll.Fields.Add(&core.TextField{Name: "device_type"})
		coll.Fields.Add(&core.TextField{Name: "firmware_version"})
		coll.Fields.Add(&core.JSONField{Name: "registration"})
		coll.Fields.Add(&core.DateField{Name: "first_seen"})
		coll.Fields.Add(&core.DateField{Name: "last_seen"})
		coll.Fields.Add(&core.BoolField{Name: "is_active"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create devices: %v", err)
			return
		}
		log.Println("bootstrap: created collection devices")
	}
	// Note: Existing "devices" collections created before app_key was added need the field
	// added via PocketBase Admin UI (Settings → devices → New field "app_key", type Text).

	// telemetry
	if _, err := app.FindCollectionByNameOrId("telemetry"); err != nil {
		coll := core.NewBaseCollection("telemetry")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.JSONField{Name: "data", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "rssi"})
		coll.Fields.Add(&core.NumberField{Name: "snr"})
		coll.Fields.Add(&core.DateField{Name: "ts"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create telemetry: %v", err)
			return
		}
		log.Println("bootstrap: created collection telemetry")
	}

	// device_controls
	if _, err := app.FindCollectionByNameOrId("device_controls"); err != nil {
		coll := core.NewBaseCollection("device_controls")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "control_key", Required: true})
		coll.Fields.Add(&core.TextField{Name: "current_state", Required: true})
		coll.Fields.Add(&core.TextField{Name: "mode"})
		coll.Fields.Add(&core.DateField{Name: "manual_until"})
		coll.Fields.Add(&core.DateField{Name: "last_change_at"})
		coll.Fields.Add(&core.TextField{Name: "last_change_by"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create device_controls: %v", err)
		} else {
			log.Println("bootstrap: created collection device_controls")
		}
	}

	// state_changes
	if _, err := app.FindCollectionByNameOrId("state_changes"); err != nil {
		coll := core.NewBaseCollection("state_changes")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "control_key", Required: true})
		coll.Fields.Add(&core.TextField{Name: "old_state"})
		coll.Fields.Add(&core.TextField{Name: "new_state", Required: true})
		coll.Fields.Add(&core.TextField{Name: "reason"})
		coll.Fields.Add(&core.DateField{Name: "device_ts"})
		coll.Fields.Add(&core.DateField{Name: "ts"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create state_changes: %v", err)
		} else {
			log.Println("bootstrap: created collection state_changes")
		}
	}

	// commands
	if _, err := app.FindCollectionByNameOrId("commands"); err != nil {
		coll := core.NewBaseCollection("commands")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "command_key", Required: true})
		coll.Fields.Add(&core.JSONField{Name: "payload"})
		coll.Fields.Add(&core.TextField{Name: "initiated_by", Required: true})
		coll.Fields.Add(&core.TextField{Name: "status"})
		coll.Fields.Add(&core.DateField{Name: "sent_at"})
		coll.Fields.Add(&core.DateField{Name: "acked_at"})
		coll.Fields.Add(&core.DateField{Name: "created_at"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create commands: %v", err)
		} else {
			log.Println("bootstrap: created collection commands")
		}
	}

	// firmware_history
	if _, err := app.FindCollectionByNameOrId("firmware_history"); err != nil {
		coll := core.NewBaseCollection("firmware_history")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.DateField{Name: "started_at"})
		coll.Fields.Add(&core.DateField{Name: "finished_at"})
		coll.Fields.Add(&core.TextField{Name: "outcome", Required: true})
		coll.Fields.Add(&core.TextField{Name: "firmware_version"})
		coll.Fields.Add(&core.NumberField{Name: "total_chunks"})
		coll.Fields.Add(&core.NumberField{Name: "chunks_received"})
		coll.Fields.Add(&core.TextField{Name: "error_message"})
		coll.Fields.Add(&core.NumberField{Name: "error_chunk_index"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create firmware_history: %v", err)
		} else {
			log.Println("bootstrap: created collection firmware_history")
		}
	}

	// edge_rules
	if _, err := app.FindCollectionByNameOrId("edge_rules"); err != nil {
		coll := core.NewBaseCollection("edge_rules")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "rule_id", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "field_idx", Required: true})
		coll.Fields.Add(&core.TextField{Name: "operator", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "threshold", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "control_idx", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "action_state", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "priority"})
		coll.Fields.Add(&core.NumberField{Name: "cooldown_seconds"})
		coll.Fields.Add(&core.BoolField{Name: "enabled"})
		coll.Fields.Add(&core.DateField{Name: "synced_at"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create edge_rules: %v", err)
		} else {
			log.Println("bootstrap: created collection edge_rules")
		}
	}

	// device_fields
	if _, err := app.FindCollectionByNameOrId("device_fields"); err != nil {
		coll := core.NewBaseCollection("device_fields")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "field_key", Required: true})
		coll.Fields.Add(&core.TextField{Name: "display_name", Required: true})
		coll.Fields.Add(&core.TextField{Name: "data_type", Required: true})
		coll.Fields.Add(&core.TextField{Name: "unit"})
		coll.Fields.Add(&core.TextField{Name: "category", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "min_value"})
		coll.Fields.Add(&core.NumberField{Name: "max_value"})
		coll.Fields.Add(&core.JSONField{Name: "enum_values"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create device_fields: %v", err)
		} else {
			log.Println("bootstrap: created collection device_fields")
		}
	}

	// lorawan_sessions: LoRaWAN 1.0 session keys and FCnt (by device_eui)
	if _, err := app.FindCollectionByNameOrId("lorawan_sessions"); err != nil {
		coll := core.NewBaseCollection("lorawan_sessions")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.TextField{Name: "dev_addr_hex", Required: true})
		coll.Fields.Add(&core.TextField{Name: "nwk_skey_hex", Required: true})
		coll.Fields.Add(&core.TextField{Name: "app_skey_hex", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "f_cnt_up", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "f_cnt_down", Required: true})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create lorawan_sessions: %v", err)
		} else {
			log.Println("bootstrap: created collection lorawan_sessions")
		}
	}

	// device_schemas
	if _, err := app.FindCollectionByNameOrId("device_schemas"); err != nil {
		coll := core.NewBaseCollection("device_schemas")
		coll.Fields.Add(&core.TextField{Name: "device_eui", Required: true})
		coll.Fields.Add(&core.NumberField{Name: "version", Required: true})
		coll.Fields.Add(&core.JSONField{Name: "schema", Required: true})
		coll.Fields.Add(&core.DateField{Name: "created_at"})
		setPublicListAndViewRules(coll)
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: create device_schemas: %v", err)
		} else {
			log.Println("bootstrap: created collection device_schemas")
		}
	}

	// Ensure app collections allow public list/view (no auth for now).
	// edge_rules also needs public create/update for the UI "Add rule" form.
	collectionNames := []string{"devices", "telemetry", "device_controls", "state_changes", "commands", "firmware_history", "edge_rules", "device_fields", "device_schemas", "lorawan_sessions"}
	empty := ""
	for _, name := range collectionNames {
		coll, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			continue
		}
		coll.ListRule = &empty
		coll.ViewRule = &empty
		if name == "edge_rules" {
			coll.CreateRule = &empty
			coll.UpdateRule = &empty
		}
		if err := app.Save(coll); err != nil {
			log.Printf("bootstrap: set public rules for %s: %v", name, err)
		}
	}
}
