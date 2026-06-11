package automations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterGuards validates automation writes at the request boundary (no broker
// needed). The owner RBAC rule already scopes by site; these add the two checks it
// can't express: the chosen controller must belong to that site, and a controller
// holds at most maxAutomations — the firmware wire cap, beyond which the retained
// set would silently truncate to a nondeterministic subset.
func RegisterGuards(app core.App) {
	guard := func(isCreate bool) func(*core.RecordRequestEvent) error {
		return func(e *core.RecordRequestEvent) error {
			site := e.Record.GetString("site")
			ctrl := e.Record.GetString("controller")

			c, err := e.App.FindRecordById("controllers", ctrl)
			if err != nil || c.GetString("site") != site {
				return apis.NewBadRequestError("Controller does not belong to this site.", nil)
			}

			if isCreate {
				rows, err := e.App.FindRecordsByFilter(
					"automations", "site = {:s} && controller = {:c}", "", 0, 0,
					dbx.Params{"s": site, "c": ctrl},
				)
				if err == nil && len(rows) >= maxAutomations {
					return apis.NewBadRequestError("Automation limit reached for this controller.", nil)
				}
			}
			return e.Next()
		}
	}
	app.OnRecordCreateRequest("automations").BindFunc(guard(true))
	app.OnRecordUpdateRequest("automations").BindFunc(guard(false))
}
