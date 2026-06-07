package main

import (
	"net/http"

	"github.com/kisinga/farmon/firmware/pkg/boardinfo"
	"github.com/pocketbase/pocketbase/core"
)

// GET /api/farmon/board-info?model={model}
// Returns pin definitions and SVG layout for the given hardware model.
// If model is omitted, returns all board definitions.
func boardInfoHandler() func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		model := e.Request.URL.Query().Get("model")
		if model == "" {
			return e.JSON(http.StatusOK, boardinfo.All())
		}
		b := boardinfo.ForModel(model)
		if b == nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "unknown model"})
		}
		return e.JSON(http.StatusOK, b)
	}
}
