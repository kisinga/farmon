package main

import "testing"

func TestIsInTimeWindow_Normal(t *testing.T) {
	// Window 6-18 (6am to 6pm)
	tests := []struct {
		hour   int
		active bool
	}{
		{5, false},
		{6, true},
		{12, true},
		{17, true},
		{18, false},
		{23, false},
		{0, false},
	}
	for _, tt := range tests {
		got := isInTimeWindow(tt.hour, 6, 18)
		if got != tt.active {
			t.Errorf("isInTimeWindow(%d, 6, 18) = %v, want %v", tt.hour, got, tt.active)
		}
	}
}

func TestIsInTimeWindow_Overnight(t *testing.T) {
	// Window 22-6 (10pm to 6am overnight)
	tests := []struct {
		hour   int
		active bool
	}{
		{21, false},
		{22, true},
		{23, true},
		{0, true},
		{3, true},
		{5, true},
		{6, false},
		{12, false},
	}
	for _, tt := range tests {
		got := isInTimeWindow(tt.hour, 22, 6)
		if got != tt.active {
			t.Errorf("isInTimeWindow(%d, 22, 6) = %v, want %v", tt.hour, got, tt.active)
		}
	}
}

func TestIsInTimeWindow_AllDay(t *testing.T) {
	// Window 0-0: start == end → never active (0 >= 0 && 0 < 0 = false)
	if isInTimeWindow(12, 0, 0) {
		t.Error("window 0-0 should never be active")
	}
}
