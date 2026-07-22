package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Shengda metering: network meters (no field controller), their readings, the
// downlink command queue, unclaimed-device sightings, and health events.
//
//   - meter_devices: one row per physical meter, claimed to a site. imei is the
//     wire identity and unique. Written server-side (claim route / ingestion);
//     customers read only.
//   - meter_readings: append-only cumulative readings in integer MILLILITRES
//     (architecture §5 invariant; the wire reports litres, converted at ingest).
//     Dedupe idempotency key is (meter, message_id, device_ts) — the wire's
//     message_id is a random 16-bit value and collides on its own.
//   - meter_commands: the one-at-a-time downlink queue (valve etc.). Commands
//     expire unsent after MAJI_METER_CMD_TTL_H (default 48h).
//   - meter_sightings: unknown devices that phoned home, for operator claiming.
//   - meter_events: health/security events (e.g. known IMEI from a new source).
func init() {
	m.Register(func(app core.App) error {
		adminOrSiteOwner := types.Pointer(`@request.auth.id != "" && (@request.auth.role = "admin" || site.owner = @request.auth.id)`)
		adminOnly := types.Pointer(`@request.auth.role = "admin"`)

		sites, err := app.FindCollectionByNameOrId("sites")
		if err != nil {
			return err
		}
		units, err := app.FindCollectionByNameOrId("billing_units")
		if err != nil {
			return err
		}

		devices := core.NewBaseCollection("meter_devices")
		devices.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "unit", CollectionId: units.Id, MaxSelect: 1},
			&core.TextField{Name: "imei", Required: true, Max: 20},
			&core.TextField{Name: "sn", Max: 40},
			&core.TextField{Name: "name", Max: 200},
			&core.TextField{Name: "model", Max: 60},
			&core.SelectField{Name: "comm_type", Values: []string{"nb_iot", "cat1", "rs485", "lorawan"}, MaxSelect: 1},
			&core.BoolField{Name: "valve_capable"},
			&core.SelectField{Name: "valve_state", Values: []string{"unknown", "open", "closed"}, MaxSelect: 1},
			&core.NumberField{Name: "reporting_interval_s", OnlyInt: true},
			&core.DateField{Name: "last_uplink_at"},
			&core.NumberField{Name: "last_reading_ml", OnlyInt: true},
			&core.DateField{Name: "last_reading_at"},
			&core.JSONField{Name: "raw_last", MaxSize: 200_000},
			&core.SelectField{Name: "status", Values: []string{"active", "disabled"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		devices.AddIndex("idx_meter_devices_imei", true, "imei", "")
		devices.AddIndex("idx_meter_devices_site", false, "site", "")
		devices.ListRule = adminOrSiteOwner
		devices.ViewRule = adminOrSiteOwner
		devices.CreateRule = adminOnly
		devices.UpdateRule = adminOnly
		devices.DeleteRule = adminOnly
		if err := app.Save(devices); err != nil {
			return err
		}

		readings := core.NewBaseCollection("meter_readings")
		readings.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.RelationField{Name: "meter", CollectionId: devices.Id, MaxSelect: 1, Required: true, CascadeDelete: false},
			&core.DateField{Name: "device_ts"},   // when the meter took the reading (/80/0 key 21)
			&core.DateField{Name: "received_at"}, // server clock
			&core.NumberField{Name: "cumulative_ml", OnlyInt: true},
			&core.NumberField{Name: "message_id", OnlyInt: true},
			&core.JSONField{Name: "signal", MaxSize: 20_000}, // rsrp/snr etc., semantics unverified
			&core.JSONField{Name: "raw_cbor", MaxSize: 200_000},
			&core.TextField{Name: "raw_hex", Max: 10_000},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		// Idempotency: a replayed uplink shares all three; a random 16-bit
		// message_id alone does NOT dedupe safely (birthday collisions).
		readings.AddIndex("idx_meter_readings_dedupe", true, "meter,message_id,device_ts", "")
		readings.AddIndex("idx_meter_readings_meter_ts", false, "meter,device_ts", "")
		readings.ListRule = adminOrSiteOwner
		readings.ViewRule = adminOrSiteOwner
		readings.CreateRule = adminOnly
		readings.UpdateRule = adminOnly
		readings.DeleteRule = adminOnly
		if err := app.Save(readings); err != nil {
			return err
		}

		commands := core.NewBaseCollection("meter_commands")
		commands.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "meter", CollectionId: devices.Id, MaxSelect: 1, Required: true},
			&core.SelectField{Name: "type", Values: []string{"valve_open", "valve_close", "set_interval", "calibrate", "read_frozen"}, MaxSelect: 1, Required: true},
			&core.JSONField{Name: "payload", MaxSize: 20_000},
			&core.SelectField{Name: "status", Values: []string{"queued", "sent", "acked", "failed", "expired"}, MaxSelect: 1, Required: true},
			&core.TextField{Name: "queued_by", Max: 100},  // user id or "rule:arrears"
			&core.TextField{Name: "queued_role", Max: 20}, // issuer role for audit
			&core.DateField{Name: "sent_at"},
			&core.DateField{Name: "acked_at"},
			&core.TextField{Name: "error", Max: 500},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		commands.AddIndex("idx_meter_commands_meter_status", false, "meter,status,created", "")
		commands.ListRule = adminOrSiteOwner
		commands.ViewRule = adminOrSiteOwner
		commands.CreateRule = adminOnly
		commands.UpdateRule = adminOnly
		commands.DeleteRule = adminOnly
		if err := app.Save(commands); err != nil {
			return err
		}

		sightings := core.NewBaseCollection("meter_sightings")
		sightings.Fields.Add(
			&core.TextField{Name: "imei", Max: 20},
			&core.TextField{Name: "sn", Max: 40},
			&core.TextField{Name: "source_ip", Max: 60},
			&core.JSONField{Name: "raw_cbor", MaxSize: 200_000},
			&core.TextField{Name: "raw_hex", Max: 10_000},
			&core.DateField{Name: "first_seen"},
			&core.DateField{Name: "last_seen"},
			&core.SelectField{Name: "status", Values: []string{"unclaimed", "claimed", "ignored"}, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		sightings.AddIndex("idx_meter_sightings_imei", false, "imei", "")
		// No site relation: unclaimed devices belong to nobody yet.
		sightings.ListRule = adminOnly
		sightings.ViewRule = adminOnly
		sightings.CreateRule = adminOnly
		sightings.UpdateRule = adminOnly
		sightings.DeleteRule = adminOnly
		if err := app.Save(sightings); err != nil {
			return err
		}

		events := core.NewBaseCollection("meter_events")
		events.Fields.Add(
			&core.RelationField{Name: "site", CollectionId: sites.Id, MaxSelect: 1},
			&core.RelationField{Name: "meter", CollectionId: devices.Id, MaxSelect: 1},
			&core.TextField{Name: "type", Required: true, Max: 60}, // e.g. new_source_ip, command_expired
			&core.SelectField{Name: "severity", Values: []string{"info", "warning", "critical"}, MaxSelect: 1},
			&core.TextField{Name: "message", Max: 1000},
			&core.DateField{Name: "occurred_at"},
			&core.DateField{Name: "resolved_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		events.AddIndex("idx_meter_events_meter", false, "meter,occurred_at", "")
		events.ListRule = adminOrSiteOwner
		events.ViewRule = adminOrSiteOwner
		events.CreateRule = adminOnly
		events.UpdateRule = adminOnly
		events.DeleteRule = adminOnly
		return app.Save(events)
	}, func(app core.App) error {
		for _, name := range []string{"meter_events", "meter_sightings", "meter_commands", "meter_readings", "meter_devices"} {
			if c, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(c); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
