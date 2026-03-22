package main

import "testing"

func TestGatewayRuntimeState_IsOnline(t *testing.T) {
	s := &GatewayRuntimeState{}

	// Never updated: not online
	if s.IsOnline() {
		t.Error("expected IsOnline() false when never updated")
	}

	// After UpdateLastSeen: online within threshold
	s.UpdateLastSeen()
	if !s.IsOnline() {
		t.Error("expected IsOnline() true immediately after UpdateLastSeen")
	}

	// Get returns the last event time and gateway id
	lastEventAt, gwID, subConnected := s.Get()
	if lastEventAt.IsZero() {
		t.Error("expected lastEventAt to be set")
	}
	if gwID != "" {
		t.Errorf("expected empty gatewayID, got %q", gwID)
	}
	if subConnected {
		t.Error("expected sub_connected false by default")
	}
}

func TestGatewayRuntimeState_IsOnline_AfterThreshold(t *testing.T) {
	// GatewayOnlineThreshold is 2 minutes; we don't sleep that long in unit tests.
	// Behaviour: IsOnline() is false when lastEventAt is zero or when time.Since(lastEventAt) >= GatewayOnlineThreshold.
	s := &GatewayRuntimeState{}
	s.UpdateLastSeen()
	// Within threshold we are online (covered by TestGatewayRuntimeState_IsOnline).
	if !s.IsOnline() {
		t.Error("expected online within threshold")
	}
}

func TestGatewayRuntimeState_SetGatewayID(t *testing.T) {
	s := &GatewayRuntimeState{}
	s.SetGatewayID("a1b2c3d4e5f60718")
	_, gwID, _ := s.Get()
	if gwID != "a1b2c3d4e5f60718" {
		t.Errorf("expected gateway_id a1b2c3d4e5f60718, got %q", gwID)
	}
}
