package main

import (
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/kisinga/farmon/firmware/pkg/catalog"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/driver-catalog?target=rp2040&io_type=i2c
func driverCatalogHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		drivers := catalog.Drivers
		if target := e.Request.URL.Query().Get("target"); target != "" {
			drivers = catalog.DriversForTarget(target)
		}
		if ioType := e.Request.URL.Query().Get("io_type"); ioType != "" {
			var filtered []catalog.DriverDef
			for _, d := range drivers {
				if d.IOType == catalog.IOType(ioType) {
					filtered = append(filtered, d)
				}
			}
			drivers = filtered
		}
		return e.JSON(http.StatusOK, map[string]any{"drivers": drivers})
	}
}

// GET /api/farmon/devices/{eui}/firmware
func firmwareStatusHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}

		driverIDs, _ := deriveDriverIDs(app, eui)

		device, _ := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		fwRec, _ := app.FindFirstRecordByFilter("device_firmware", "device_eui = {:eui}", dbx.Params{"eui": eui})

		resp := map[string]any{
			"device_eui":       eui,
			"required_drivers": driverIDs,
		}
		if device != nil {
			resp["hardware_model"] = device.Get("hardware_model")
			resp["transport"] = device.Get("transport")
		}
		if fwRec != nil {
			resp["build_status"] = fwRec.Get("build_status")
			resp["last_build_at"] = fwRec.Get("last_build_at")
			resp["build_log"] = fwRec.Get("build_log")
			resp["wifi_ssid"] = fwRec.Get("wifi_ssid")
			resp["backend_url"] = fwRec.Get("backend_url")
		} else {
			resp["build_status"] = "none"
		}
		return e.JSON(http.StatusOK, resp)
	}
}

// POST /api/farmon/devices/{eui}/firmware/credentials
func firmwareCredentialsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		var body struct {
			WiFiSSID     string `json:"wifi_ssid"`
			WiFiPassword string `json:"wifi_password"`
			BackendURL   string `json:"backend_url"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		rec, err := getOrCreateFirmwareRecord(app, eui)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		if body.WiFiSSID != "" {
			rec.Set("wifi_ssid", body.WiFiSSID)
		}
		if body.WiFiPassword != "" {
			rec.Set("wifi_password", body.WiFiPassword)
		}
		if body.BackendURL != "" {
			rec.Set("backend_url", body.BackendURL)
		}
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/farmon/devices/{eui}/firmware/build
func firmwareBuildHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		device, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}
		hwModel, _ := device.Get("hardware_model").(string)
		if hwModel == "" {
			hwModel = "rp2040"
		}
		driverIDs, err := deriveDriverIDs(app, eui)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("cannot derive drivers: %v", err)})
		}
		fwRec, _ := getOrCreateFirmwareRecord(app, eui)
		creds := buildCredentials(device, fwRec, e.Request.Host)

		fwRec.Set("build_status", "building")
		_ = app.Save(fwRec)

		result := buildFirmware(app, FirmwareBuildRequest{
			DeviceEUI:     eui,
			HardwareModel: hwModel,
			DriverIDs:     driverIDs,
			Credentials:   creds,
		})

		if result.Success {
			fwRec.Set("build_status", "success")
		} else {
			fwRec.Set("build_status", "failed")
		}
		fwRec.Set("build_log", result.BuildLog)
		_ = app.Save(fwRec)

		return e.JSON(http.StatusOK, map[string]any{
			"success":     result.Success,
			"binary_size": result.BinarySize,
			"target":      result.Target,
			"build_log":   result.BuildLog,
			"error":       result.Error,
		})
	}
}

// GET /api/farmon/devices/{eui}/firmware/download
func firmwareDownloadHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(e.Request.PathValue("eui"))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui required")
		}
		device, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}
		hwModel, _ := device.Get("hardware_model").(string)
		_, ext, _ := targetInfo(hwModel)
		binaryPath := fmt.Sprintf("builds/%s/firmware%s", eui, ext)
		if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "no firmware binary, trigger a build first"})
		}
		filename := fmt.Sprintf("farmon-%s%s", eui[:8], ext)
		e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		return e.FileFS(os.DirFS("."), binaryPath)
	}
}

func buildCredentials(device *core.Record, fwRec *core.Record, host string) deviceConfigData {
	creds := deviceConfigData{}
	transport, _ := device.Get("transport").(string)
	if transport == "wifi" {
		creds.WiFiSSID, _ = fwRec.Get("wifi_ssid").(string)
		creds.WiFiPassword, _ = fwRec.Get("wifi_password").(string)
		creds.BackendHost, _ = fwRec.Get("backend_host").(string)
		creds.BackendPort, _ = fwRec.Get("backend_port").(string)
		creds.BackendPath, _ = fwRec.Get("backend_path").(string)
		if creds.BackendHost == "" {
			creds.BackendHost = strings.Split(host, ":")[0]
		}
		if creds.BackendPort == "" {
			if parts := strings.Split(host, ":"); len(parts) > 1 {
				creds.BackendPort = parts[1]
			} else {
				creds.BackendPort = "8090"
			}
		}
		if creds.BackendPath == "" {
			creds.BackendPath = "/api/farmon/ingest"
		}
		creds.DeviceToken, _ = device.Get("device_token").(string)
	} else {
		appKeyHex, _ := device.Get("app_key").(string)
		creds.AppKeyBytes = hexToByteSlice(appKeyHex)
		creds.Region = 0
		creds.SubBand = 2
	}
	return creds
}

func hexToByteSlice(h string) string {
	h = strings.ReplaceAll(h, " ", "")
	b, err := hex.DecodeString(h)
	if err != nil || len(b) == 0 {
		return "0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00"
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("0x%02X", v)
	}
	return strings.Join(parts, ", ")
}

func getOrCreateFirmwareRecord(app core.App, eui string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter("device_firmware", "device_eui = {:eui}", dbx.Params{"eui": eui})
	if err == nil {
		return rec, nil
	}
	coll, err := app.FindCollectionByNameOrId("device_firmware")
	if err != nil {
		return nil, fmt.Errorf("device_firmware collection not found: %w", err)
	}
	rec = core.NewRecord(coll)
	rec.Set("device_eui", eui)
	rec.Set("build_status", "none")
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// ensureFirmwareCollections ensures the device_firmware collection exists in PocketBase.
func ensureFirmwareCollections(app core.App) {
	// device_firmware
	if _, err := app.FindCollectionByNameOrId("device_firmware"); err != nil {
		coll := core.NewBaseCollection("device_firmware")
		coll.Fields.Add(
			&core.TextField{Name: "device_eui", Required: true},
			&core.TextField{Name: "wifi_ssid"},
			&core.TextField{Name: "wifi_password"},
			&core.TextField{Name: "backend_url"},
			&core.TextField{Name: "build_status"},
			&core.TextField{Name: "build_log"},
			&core.TextField{Name: "last_build_at"},
			&core.TextField{Name: "last_build_hash"},
			&core.TextField{Name: "firmware_version"},
		)
		if err := app.Save(coll); err != nil {
			fmt.Printf("[firmware] failed to create device_firmware collection: %v\n", err)
		}
	}
}

// seedFirmwareData seeds initial firmware metadata (no-op for now, data comes from catalog).
func seedFirmwareData(_ core.App) {}

// GET /api/farmon/firmware-commands — lists available firmware commands.
func listFirmwareCommandsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		recs, err := app.FindAllRecords("firmware_commands")
		if err != nil {
			return e.JSON(http.StatusOK, []any{})
		}
		var out []map[string]any
		for _, r := range recs {
			out = append(out, map[string]any{
				"command_key":  r.Get("command_key"),
				"name":         r.Get("name"),
				"fport":        r.Get("fport"),
				"payload_type": r.Get("payload_type"),
				"description":  r.Get("description"),
			})
		}
		return e.JSON(http.StatusOK, out)
	}
}

// GET /api/farmon/backend-info
func getBackendInfoHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rec, err := app.FindFirstRecordByFilter("backend_info", "id != ''")
		if err != nil {
			return e.JSON(http.StatusOK, map[string]any{"supported_firmware_versions": []string{"1.0.0"}})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"supported_firmware_versions": rec.Get("supported_firmware_versions"),
		})
	}
}

// PATCH /api/farmon/backend-info
func patchBackendInfoHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.String(http.StatusBadRequest, "invalid body")
		}
		rec, err := app.FindFirstRecordByFilter("backend_info", "id != ''")
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "no backend_info record"})
		}
		for k, v := range body {
			rec.Set(k, v)
		}
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	}
}
