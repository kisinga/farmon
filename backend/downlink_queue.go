package main

import (
	"log"
	"sync"
	"time"
)

// pendingDownlink is a pre-built LoRaWAN PHY frame waiting to be sent in the next Class A RX window.
type pendingDownlink struct {
	PHY     []byte // encrypted, MIC'd LoRaWAN PHY payload
	FPort   uint8  // for logging
	Queued  time.Time
	DevEUI  string // for logging
	Payload []byte // original cleartext payload (for logging/recording)
}

// DownlinkQueue holds pending downlinks per device, keyed by normalized DevEUI.
// Class A devices only receive downlinks in the RX1/RX2 window after an uplink,
// so API-triggered downlinks are queued here and drained when the next uplink arrives.
type DownlinkQueue struct {
	mu    sync.Mutex
	queue map[string][]pendingDownlink
}

// NewDownlinkQueue creates a new empty queue.
func NewDownlinkQueue() *DownlinkQueue {
	return &DownlinkQueue{queue: make(map[string][]pendingDownlink)}
}

// Enqueue adds a pre-built PHY frame to the device's pending queue.
// Only the most recent downlink per device is kept (Class A can only send one per uplink cycle).
func (q *DownlinkQueue) Enqueue(devEUI string, fPort uint8, phyRaw []byte, clearPayload []byte) {
	q.mu.Lock()
	defer q.mu.Unlock()
	// Replace any existing pending downlink — only the latest command matters.
	// This avoids stale commands piling up and consuming multiple RX windows.
	q.queue[devEUI] = []pendingDownlink{{
		PHY:     phyRaw,
		FPort:   fPort,
		Queued:  time.Now(),
		DevEUI:  devEUI,
		Payload: clearPayload,
	}}
	log.Printf("downlink_queue: enqueued fPort=%d for dev_eui=%s (waiting for next uplink)", fPort, devEUI)
}

// Drain returns and removes the next pending downlink for the device, or nil if none.
// Stale entries older than 10 minutes are discarded.
func (q *DownlinkQueue) Drain(devEUI string) *pendingDownlink {
	q.mu.Lock()
	defer q.mu.Unlock()
	pending := q.queue[devEUI]
	if len(pending) == 0 {
		return nil
	}
	dl := pending[0]
	// Discard if too old (device may have reset session / re-joined)
	if time.Since(dl.Queued) > 10*time.Minute {
		log.Printf("downlink_queue: discarding stale entry for dev_eui=%s (queued %v ago)", devEUI, time.Since(dl.Queued).Round(time.Second))
		delete(q.queue, devEUI)
		return nil
	}
	// Remove from queue
	if len(pending) == 1 {
		delete(q.queue, devEUI)
	} else {
		q.queue[devEUI] = pending[1:]
	}
	return &dl
}

// Pending returns the count of devices with pending downlinks.
func (q *DownlinkQueue) Pending() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.queue)
}
