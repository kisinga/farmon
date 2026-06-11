package telemetry

import "testing"

func TestParseTopic(t *testing.T) {
	cases := []struct {
		topic                string
		ok                   bool
		site, ctrl, sensor   string
	}{
		{"majiflow/site1/dev1/telemetry/flow", true, "site1", "dev1", "flow"},
		{"majiflow/s/c/telemetry/temp", true, "s", "c", "temp"},
		{"majiflow/site1/dev1/command/relay", false, "", "", ""},
		{"majiflow/site1/dev1/telemetry", false, "", "", ""},
		{"other/site1/dev1/telemetry/flow", false, "", "", ""},
		{"majiflow//dev1/telemetry/flow", false, "", "", ""},
	}
	for _, c := range cases {
		site, ctrl, sensor, ok := ParseTopic(c.topic)
		if ok != c.ok || site != c.site || ctrl != c.ctrl || sensor != c.sensor {
			t.Errorf("ParseTopic(%q) = (%q,%q,%q,%v), want (%q,%q,%q,%v)",
				c.topic, site, ctrl, sensor, ok, c.site, c.ctrl, c.sensor, c.ok)
		}
	}
}

func TestParseIdentityTopic(t *testing.T) {
	cases := []struct {
		topic      string
		ok         bool
		site, ctrl string
	}{
		{"majiflow/site1/dev1/identity", true, "site1", "dev1"},
		{"majiflow/s/c/identity", true, "s", "c"},
		{"majiflow/site1/dev1/status", false, "", ""},
		{"majiflow/site1/dev1/identity/extra", false, "", ""},
		{"other/site1/dev1/identity", false, "", ""},
		{"majiflow//dev1/identity", false, "", ""},
		{"majiflow/site1//identity", false, "", ""},
	}
	for _, c := range cases {
		site, ctrl, ok := ParseIdentityTopic(c.topic)
		if ok != c.ok || site != c.site || ctrl != c.ctrl {
			t.Errorf("ParseIdentityTopic(%q) = (%q,%q,%v), want (%q,%q,%v)",
				c.topic, site, ctrl, ok, c.site, c.ctrl, c.ok)
		}
	}
}
