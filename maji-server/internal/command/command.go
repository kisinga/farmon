// Package command is the single source of truth for the downstream command JSON
// published on a controller's command topic. It mirrors the CommandEnvelope union,
// CommandAction, and COMMAND_TTL_S in src/lib/codegen-ids.ts — the firmware decodes
// exactly this shape. Building the envelope by hand in the API handlers let the two
// sides drift; this package validates the action+args and emits the wire bytes in
// one place, with a golden-vector test (command_test.go) pinning the JSON.
package command

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Action mirrors CommandAction in src/lib/codegen-ids.ts. firmware_update is a
// server-only action (published by /firmware/deploy), absent from the operator
// allow-list below.
type Action string

const (
	RouteStart     Action = "route_start"
	RouteStop      Action = "route_stop"
	FaultReset     Action = "fault_reset"
	StopAll        Action = "stop_all"
	ResetFaults    Action = "reset_faults"
	ClearQueue     Action = "clear_queue"
	NodeSet        Action = "node_set"
	SafetyOverride Action = "safety_override"
	FirmwareUpdate Action = "firmware_update"
)

// TTLSeconds mirrors COMMAND_TTL_S: the device drops a command whose issued_at is
// older than this (now - issued_at, by its SNTP clock), so one queued during an
// outage never fires on reconnect.
const TTLSeconds = 120

// operatorActions is the POST /command allow-list — every action an operator may
// issue. firmware_update is deliberately excluded (server-only).
var operatorActions = map[Action]bool{
	RouteStart: true, RouteStop: true, FaultReset: true,
	StopAll: true, ResetFaults: true, ClearQueue: true,
	NodeSet: true, SafetyOverride: true,
}

// routeActions require a route_id; onActions require an `on` bool.
var routeActions = map[Action]bool{RouteStart: true, RouteStop: true, FaultReset: true}
var onActions = map[Action]bool{NodeSet: true, SafetyOverride: true}

// Command is one downstream instruction in plain values. The action determines which
// optional fields are meaningful; Encode emits only the fields that are set (matching
// the per-action variants of CommandEnvelope), and ValidateOperator enforces the
// per-action argument requirements for the operator surface.
type Command struct {
	CommandID string
	Action    Action
	IssuedAt  int64
	Actor     string // issuing user id; the device re-publishes it as a run's origin

	RouteID *int   // route_start / route_stop / fault_reset
	NodeID  string // node_set
	On      *bool  // node_set / safety_override

	// route_start only: a per-run StopSpec override. OverrideMask selects which
	// ov_* fields are active (mirrors OVERRIDE_BITS / enum OverrideBit); an unset
	// field falls through to the route's live tunable on the device. All nil ⇒ the
	// run uses the route's baked defaults (the pre-targeted-runs behaviour).
	OverrideMask      *int
	OvSourceMinPct    *int
	OvDestMaxPct      *int
	OvMaxRuntimeMin   *int
	OvTargetDurationS *int
	OvTargetVolumeL   *int

	// firmware_update (server-only).
	Version string
	URL     string
	MD5     string
}

// envelope is the exact wire shape. Pointer + omitempty drops an absent optional but
// keeps a present false/0 (a node release is on:false, a setpoint can be 0, route 0
// is a real id), so the device always sees the fields its action carries.
type envelope struct {
	CommandID string   `json:"command_id"`
	Action    Action   `json:"action"`
	IssuedAt  int64    `json:"issued_at"`
	Actor     string   `json:"actor,omitempty"`
	RouteID   *int     `json:"route_id,omitempty"`
	NodeID    string   `json:"node_id,omitempty"`
	On        *bool    `json:"on,omitempty"`
	OverrideMask      *int `json:"override_mask,omitempty"`
	OvSourceMinPct    *int `json:"ov_source_min_pct,omitempty"`
	OvDestMaxPct      *int `json:"ov_dest_max_pct,omitempty"`
	OvMaxRuntimeMin   *int `json:"ov_max_runtime_min,omitempty"`
	OvTargetDurationS *int `json:"ov_target_duration_s,omitempty"`
	OvTargetVolumeL   *int `json:"ov_target_volume_l,omitempty"`
	Version   string   `json:"version,omitempty"`
	URL       string   `json:"url,omitempty"`
	MD5       string   `json:"md5,omitempty"`
}

// ValidateOperator checks an operator-issued command (the POST /command surface):
// the action must be in the operator allow-list and carry its required args. It
// returns a client-safe message; the controller/site checks stay at the handler.
func (c Command) ValidateOperator() error {
	if !operatorActions[c.Action] {
		return errors.New("a valid action is required")
	}
	if routeActions[c.Action] && c.RouteID == nil {
		return fmt.Errorf("route_id is required for %s", c.Action)
	}
	if c.Action == NodeSet && c.NodeID == "" {
		return fmt.Errorf("node_id is required for %s", c.Action)
	}
	if onActions[c.Action] && c.On == nil {
		return fmt.Errorf("on is required for %s", c.Action)
	}
	return nil
}

// Encode marshals the command into the wire JSON the firmware decodes. The output
// is the CommandEnvelope contract — see command_test.go for the pinned vectors.
func (c Command) Encode() []byte {
	b, _ := json.Marshal(envelope{
		CommandID: c.CommandID,
		Action:    c.Action,
		IssuedAt:  c.IssuedAt,
		Actor:     c.Actor,
		RouteID:   c.RouteID,
		NodeID:    c.NodeID,
		On:        c.On,
		OverrideMask:      c.OverrideMask,
		OvSourceMinPct:    c.OvSourceMinPct,
		OvDestMaxPct:      c.OvDestMaxPct,
		OvMaxRuntimeMin:   c.OvMaxRuntimeMin,
		OvTargetDurationS: c.OvTargetDurationS,
		OvTargetVolumeL:   c.OvTargetVolumeL,
		Version:   c.Version,
		URL:       c.URL,
		MD5:       c.MD5,
	})
	return b
}
