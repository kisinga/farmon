package command

import "testing"

func iptr(v int) *int         { return &v }
func bptr(v bool) *bool       { return &v }
func fptr(v float64) *float64 { return &v }

// Golden vectors: the EXACT bytes the firmware decodes. They pin Encode to the
// CommandEnvelope union in src/lib/codegen-ids.ts — a key rename or a dropped field
// here is a silent cross-language break, so this test is the contract. If a vector
// changes, the TS type (and the firmware handler) must change with it.
func TestEncodeGoldenVectors(t *testing.T) {
	const id, at, actor = "cmd0000000000001", int64(1700000000), "u1"
	cases := []struct {
		name string
		cmd  Command
		want string
	}{
		{
			"route_start carries route_id",
			Command{CommandID: id, Action: RouteStart, IssuedAt: at, Actor: actor, RouteID: iptr(2)},
			`{"command_id":"cmd0000000000001","action":"route_start","issued_at":1700000000,"actor":"u1","route_id":2}`,
		},
		{
			"route_id 0 is a real id, not omitted",
			Command{CommandID: id, Action: RouteStop, IssuedAt: at, Actor: actor, RouteID: iptr(0)},
			`{"command_id":"cmd0000000000001","action":"route_stop","issued_at":1700000000,"actor":"u1","route_id":0}`,
		},
		{
			"stop_all carries no args",
			Command{CommandID: id, Action: StopAll, IssuedAt: at, Actor: actor},
			`{"command_id":"cmd0000000000001","action":"stop_all","issued_at":1700000000,"actor":"u1"}`,
		},
		{
			"node_set claim is on:true",
			Command{CommandID: id, Action: NodeSet, IssuedAt: at, Actor: actor, NodeID: "pump_a", On: bptr(true)},
			`{"command_id":"cmd0000000000001","action":"node_set","issued_at":1700000000,"actor":"u1","node_id":"pump_a","on":true}`,
		},
		{
			"node_set release keeps on:false",
			Command{CommandID: id, Action: NodeSet, IssuedAt: at, Actor: actor, NodeID: "pump_a", On: bptr(false)},
			`{"command_id":"cmd0000000000001","action":"node_set","issued_at":1700000000,"actor":"u1","node_id":"pump_a","on":false}`,
		},
		{
			"safety_override carries on",
			Command{CommandID: id, Action: SafetyOverride, IssuedAt: at, Actor: actor, On: bptr(true)},
			`{"command_id":"cmd0000000000001","action":"safety_override","issued_at":1700000000,"actor":"u1","on":true}`,
		},
		{
			"config_set carries key+value",
			Command{CommandID: id, Action: ConfigSet, IssuedAt: at, Actor: actor, Key: "route_0_source_min_pct", Value: fptr(40)},
			`{"command_id":"cmd0000000000001","action":"config_set","issued_at":1700000000,"actor":"u1","key":"route_0_source_min_pct","value":40}`,
		},
		{
			"firmware_update carries version+url+md5",
			Command{CommandID: id, Action: FirmwareUpdate, IssuedAt: at, Actor: actor, Version: "1.2.3", URL: "http://host/x", MD5: "abc"},
			`{"command_id":"cmd0000000000001","action":"firmware_update","issued_at":1700000000,"actor":"u1","version":"1.2.3","url":"http://host/x","md5":"abc"}`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := string(c.cmd.Encode()); got != c.want {
				t.Errorf("Encode() mismatch\n got: %s\nwant: %s", got, c.want)
			}
		})
	}
}

func TestValidateOperator(t *testing.T) {
	ok := []Command{
		{Action: RouteStart, RouteID: iptr(1)},
		{Action: StopAll},
		{Action: NodeSet, NodeID: "v1", On: bptr(false)},
		{Action: SafetyOverride, On: bptr(true)},
		{Action: ConfigSet, Key: "k", Value: fptr(0)},
	}
	for _, c := range ok {
		if err := c.ValidateOperator(); err != nil {
			t.Errorf("%s: unexpected error: %v", c.Action, err)
		}
	}

	bad := []Command{
		{Action: FirmwareUpdate, Version: "1"}, // server-only, not operator-allowed
		{Action: "bogus"},
		{Action: RouteStart},                // missing route_id
		{Action: NodeSet, On: bptr(true)},   // missing node_id
		{Action: NodeSet, NodeID: "v1"},     // missing on
		{Action: SafetyOverride},            // missing on
		{Action: ConfigSet, Key: "k"},       // missing value
		{Action: ConfigSet, Value: fptr(1)}, // missing key
	}
	for _, c := range bad {
		if err := c.ValidateOperator(); err == nil {
			t.Errorf("%s: expected validation error, got nil", c.Action)
		}
	}
}
