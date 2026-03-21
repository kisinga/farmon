package main

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/kisinga/farmon/firmware/pkg/pincaps"
	"github.com/kisinga/farmon/firmware/pkg/settings"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type pinInfoResponse struct {
	Pin       int    `json:"pin"`
	Functions []int  `json:"functions"`
	Label     string `json:"label"`
}

type pinCapsResponse struct {
	MCU  string            `json:"mcu"`
	Pins []pinInfoResponse `json:"pins"`
}

// GET /api/farmon/pin-capabilities?eui={eui}
// Returns per-pin hardware capability table for a device, sourced from the
// firmware pincaps package. The MCU is determined from the device's hardware_model
// field (set at provisioning), falling back to inference from transport.
func pinCapsHandler(app core.App) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		eui := normalizeEui(strings.TrimSpace(e.Request.URL.Query().Get("eui")))
		if eui == "" {
			return e.String(http.StatusBadRequest, "eui query param required")
		}
		for len(eui) < 16 {
			eui = "0" + eui
		}

		rec, err := app.FindFirstRecordByFilter("devices", "device_eui = {:eui}", dbx.Params{"eui": eui})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}

		// Determine MCU: use hardware_model if set, else infer from transport
		mcu := rec.GetString("hardware_model")
		if mcu == "" {
			switch rec.GetString("transport") {
			case "wifi":
				mcu = "rp2040"
			default:
				mcu = "lorae5"
			}
		}

		table := pincaps.ForMCU(mcu)

		labelPrefix := "GP"
		if mcu == "lorae5" || mcu == "stm32wl" {
			labelPrefix = "D"
		}

		pins := make([]pinInfoResponse, settings.MaxPins)
		for idx := 0; idx < settings.MaxPins; idx++ {
			var fns []int
			for fn := range pincaps.PinFunctionRequires {
				if table.ValidateFunction(uint8(idx), fn) {
					fns = append(fns, int(fn))
				}
			}
			pins[idx] = pinInfoResponse{
				Pin:       idx,
				Functions: fns,
				Label:     fmt.Sprintf("%s%d", labelPrefix, idx),
			}
		}

		return e.JSON(http.StatusOK, pinCapsResponse{MCU: mcu, Pins: pins})
	}
}
