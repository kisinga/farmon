package metering

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"
)

// Valve enqueue refusals (typed so the API layer can map them to 4xx codes).
var (
	// ErrNotValveCapable: the meter model has no controllable valve.
	ErrNotValveCapable = errors.New("metering: meter is not valve-capable")
	// ErrValveNoChange: the valve already reports the requested state.
	ErrValveNoChange = errors.New("metering: valve already in requested state")
	// ErrValvePending: another valve command is queued or awaiting its ack.
	ErrValvePending = errors.New("metering: a valve command is already pending")
)

// EnqueueValve queues a valve open/close command after the safety guards:
// the meter must be valve-capable, the command must change the reported
// state, and no other valve command may be in flight.
func EnqueueValve(app core.App, meter *core.Record, close bool, queuedBy, role string) (*core.Record, error) {
	if !meter.GetBool("valve_capable") {
		return nil, ErrNotValveCapable
	}
	switch state := meter.GetString("valve_state"); {
	case close && state == "closed":
		return nil, ErrValveNoChange
	case !close && state == "open":
		return nil, ErrValveNoChange
	}
	if HasPendingValve(app, meter.Id) {
		return nil, ErrValvePending
	}
	cmdType := CmdValveOpen
	if close {
		cmdType = CmdValveClose
	}
	rec, err := EnqueueCommand(app, meter, cmdType, nil, queuedBy, role)
	if err != nil && isUniqueViolation(err) {
		// Lost the race with another enqueue between the pre-check and the
		// save: the pending-valve partial unique index rejected the insert.
		return nil, ErrValvePending
	}
	return rec, err
}
