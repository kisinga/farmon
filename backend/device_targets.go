package main

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// DeviceTarget describes a supported hardware target with default transport and provisioning hints.
// Hardcoded catalog — changes infrequently. The frontend uses this to drive the add-device flow.
type DeviceTarget struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Transport      string `json:"transport"`       // "lorawan" | "wifi" | "" (user picks)
	DefaultProfile string `json:"default_profile"` // profile name hint, resolved to ID at runtime
	CredentialType string `json:"credential_type"` // "app_key" | "device_token" | "" (inferred from transport)
	DeviceIDFormat string `json:"device_id_format"` // "eui64" | "mac" | "custom"
}

var deviceTargets = []DeviceTarget{
	{
		ID:             "lora_e5",
		Name:           "LoRa-E5",
		Description:    "Seeed LoRa-E5 module (STM32WLE5, LoRaWAN)",
		Transport:      "lorawan",
		DefaultProfile: "FarMon Water Monitor v1",
		CredentialType: "app_key",
		DeviceIDFormat: "eui64",
	},
	{
		ID:             "xiao_esp32c6",
		Name:           "XIAO ESP32-C6",
		Description:    "Seeed XIAO ESP32-C6 (WiFi 6, BLE 5, 802.15.4)",
		Transport:      "wifi",
		DefaultProfile: "",
		CredentialType: "device_token",
		DeviceIDFormat: "mac",
	},
	{
		ID:             "custom",
		Name:           "Custom Device",
		Description:    "Any device — select transport and profile manually",
		Transport:      "",
		DefaultProfile: "",
		CredentialType: "",
		DeviceIDFormat: "custom",
	},
}

// findDeviceTarget returns the target with the given ID, or nil.
func findDeviceTarget(id string) *DeviceTarget {
	for i := range deviceTargets {
		if deviceTargets[i].ID == id {
			return &deviceTargets[i]
		}
	}
	return nil
}

// resolveDefaultProfileID looks up a profile by name and returns its ID, or "".
func resolveDefaultProfileID(app core.App, profileName string) string {
	if profileName == "" {
		return ""
	}
	rec, err := app.FindFirstRecordByFilter("device_profiles", "name = {:name}", map[string]any{"name": profileName})
	if err != nil || rec == nil {
		return ""
	}
	return rec.Id
}

// deviceTargetsHandler returns the catalog with profile names resolved to IDs.
// GET /api/farmon/device-targets
func deviceTargetsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		type targetResponse struct {
			DeviceTarget
			DefaultProfileID string `json:"default_profile_id"`
		}
		result := make([]targetResponse, len(deviceTargets))
		for i, t := range deviceTargets {
			result[i] = targetResponse{
				DeviceTarget:     t,
				DefaultProfileID: resolveDefaultProfileID(app, t.DefaultProfile),
			}
		}
		return e.JSON(http.StatusOK, result)
	}
}
