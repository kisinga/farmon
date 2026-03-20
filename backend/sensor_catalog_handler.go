package main

import (
	"net/http"

	"github.com/farmon/firmware/pkg/catalog"
	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/io-catalog — returns the full IO catalog (input + output interfaces)
// from the compiled firmware catalog package. Read-only, no persistence.
func ioCatalogHandler() func(*core.RequestEvent) error {
	cat := catalog.GetCatalog()
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, cat)
	}
}
