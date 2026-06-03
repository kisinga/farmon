package main

import (
	"sync"
	"time"
)

// GatewayOnlineThreshold is how long after the last concentratord event (up or stats) the gateway is still considered online.
const GatewayOnlineThreshold = 2 * time.Minute

// GatewayRuntimeState holds mutable runtime state for the concentratord connection.
// Written by the pipeline on every up/stats event and on gateway_id discovery; read by API handlers.
type GatewayRuntimeState struct {
	mu           sync.RWMutex
	lastEventAt  time.Time
	gatewayID    string
	subConnected bool
}

// UpdateLastSeen records that we received an event (uplink or stats) from concentratord.
func (s *GatewayRuntimeState) UpdateLastSeen() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastEventAt = time.Now()
}

// SetGatewayID sets the discovered or configured gateway ID.
func (s *GatewayRuntimeState) SetGatewayID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gatewayID = id
}

// SetSubConnected sets whether the SUB socket is connected (optional; can be inferred from last_event_at).
func (s *GatewayRuntimeState) SetSubConnected(connected bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subConnected = connected
}

// Get returns a snapshot of the runtime state.
func (s *GatewayRuntimeState) Get() (lastEventAt time.Time, gatewayID string, subConnected bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastEventAt, s.gatewayID, s.subConnected
}

// IsOnline returns true if we have received an event from concentratord within GatewayOnlineThreshold.
func (s *GatewayRuntimeState) IsOnline() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.lastEventAt.IsZero() {
		return false
	}
	return time.Since(s.lastEventAt) < GatewayOnlineThreshold
}
