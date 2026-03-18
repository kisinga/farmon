package main

import (
	"net/http"

	"github.com/farmon/firmware/pkg/catalog"
	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/sensor-catalog — returns the sensor catalog from the
// compiled firmware catalog package. Read-only, no persistence.
func sensorCatalogHandler() func(*core.RequestEvent) error {
	cat := catalog.GetCatalog()
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, cat)
	}
}
