package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/farmon/firmware/pkg/protocol"
	"github.com/pocketbase/pocketbase/core"
)

// ─── Firmware Commands (read-only, sourced from firmware/pkg/protocol) ───────
// Commands are defined once in firmware/pkg/protocol/ports.go and imported here.
// They cannot be edited via the UI — any change requires a firmware + backend
// code change, which is the correct constraint.

// FirmwareCommand is the API representation of protocol.Command.
type FirmwareCommand struct {
	Key         string `json:"command_key"`
	Name        string `json:"name"`
	FPort       int    `json:"fport"`
	PayloadType string `json:"payload_type"`
	Description string `json:"description,omitempty"`
}

func toAPICommand(c protocol.Command) FirmwareCommand {
	return FirmwareCommand{
		Key:         c.Key,
		Name:        titleCase(c.Key),
		FPort:       c.FPort,
		PayloadType: c.PayloadType,
		Description: c.Description,
	}
}

// titleCase capitalises the first letter of a word (used when Name is not set).
func titleCase(s string) string {
	if len(s) == 0 {
		return s
	}
	if s[0] >= 'a' && s[0] <= 'z' {
		return string(s[0]-32) + s[1:]
	}
	return s
}

// GET /api/farmon/firmware-commands — returns the authoritative command list from
// the compiled firmware protocol package. Read-only.
func listFirmwareCommandsHandler(_ core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		out := make([]FirmwareCommand, len(protocol.Commands))
		for i, c := range protocol.Commands {
			out[i] = toAPICommand(c)
		}
		return e.JSON(http.StatusOK, out)
	}
}

// ─── Backend Info (firmware compatibility declaration) ────────────────────────
// A single persisted record declaring which firmware versions this backend
// is compatible with. Seeded on first run; editable via the Firmware page.
//
// Workflow when shipping new firmware:
//   1. Update firmware/pkg/protocol/ports.go (add any new commands/ports).
//   2. Rebuild and deploy both firmware and backend together.
//   3. In the UI → Firmware page, add the new version string to the list.
//      No further code or deploy needed for the version declaration.

// BackendInfo holds the persisted compatibility declaration.
type BackendInfo struct {
	SupportedFirmwareVersions []string `json:"supported_firmware_versions"`
}

// GET /api/farmon/backend-info
func getBackendInfoHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, loadBackendInfo(app))
	}
}

// PATCH /api/farmon/backend-info
func patchBackendInfoHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body BackendInfo
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		rec, err := app.FindFirstRecordByFilter("backend_info", "id != ''")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "backend_info record not found"})
		}
		versionsJSON, _ := json.Marshal(body.SupportedFirmwareVersions)
		rec.Set("supported_firmware_versions", string(versionsJSON))
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, body)
	}
}

func loadBackendInfo(app core.App) BackendInfo {
	rec, err := app.FindFirstRecordByFilter("backend_info", "id != ''")
	if err != nil {
		return BackendInfo{SupportedFirmwareVersions: []string{}}
	}
	var versions []string
	raw := rec.Get("supported_firmware_versions")
	switch v := raw.(type) {
	case string:
		_ = json.Unmarshal([]byte(v), &versions)
	case []any:
		for _, s := range v {
			if str, ok := s.(string); ok {
				versions = append(versions, str)
			}
		}
	}
	if versions == nil {
		versions = []string{}
	}
	return BackendInfo{SupportedFirmwareVersions: versions}
}

// IsFirmwareCompatible returns true if version is declared compatible,
// or if no versions are declared (open — assume compatible).
func IsFirmwareCompatible(app core.App, version string) bool {
	if version == "" {
		return true
	}
	info := loadBackendInfo(app)
	if len(info.SupportedFirmwareVersions) == 0 {
		return true
	}
	for _, v := range info.SupportedFirmwareVersions {
		if v == version {
			return true
		}
	}
	return false
}

// ─── Collections + Seed ──────────────────────────────────────────────────────

func ensureFirmwareCollections(app core.App) {
	// firmware_commands is no longer persisted — served from protocol constants.
	// Only backend_info needs a collection.
	ensureBackendInfoCollection(app)
}

func ensureBackendInfoCollection(app core.App) {
	if _, err := app.FindCollectionByNameOrId("backend_info"); err == nil {
		return
	}
	col := core.NewBaseCollection("backend_info")
	col.ListRule = nil
	col.ViewRule = nil
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	col.Fields.Add(&core.JSONField{Name: "supported_firmware_versions"})
	if err := app.Save(col); err != nil {
		log.Printf("[firmware] create backend_info collection: %v", err)
	}
}

func seedFirmwareData(app core.App) {
	coll, err := app.FindCollectionByNameOrId("backend_info")
	if err != nil {
		return
	}
	if existing, _ := app.FindFirstRecordByFilter("backend_info", "id != ''"); existing != nil {
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("supported_firmware_versions", `["1.0.0"]`)
	if err := app.Save(rec); err != nil {
		log.Printf("[firmware] seed backend_info: %v", err)
		return
	}
	log.Printf("[firmware] seeded backend_info with supported_firmware_versions=[1.0.0]")
}
