package main

import (
	"log"
	"sort"
	"sync"
	"time"
)

// fportPriority returns the delivery priority for a downlink fPort.
// Higher value = higher priority = delivered first when multiple downlinks are queued.
// AirConfig must arrive before rules; rules before direct control; all before generic commands.
func fportPriority(fport uint8) int {
	switch {
	case fport == 35:
		return 100 // AirConfig
	case fport == 30:
		return 90 // RuleUpdate
	case fport == 20:
		return 80 // DirectControl
	default:
		return 70 // Commands (fPort 10-16) and anything else
	}
}

// pendingDownlink is a pre-built LoRaWAN PHY frame waiting to be sent in the next Class A RX window.
type pendingDownlink struct {
	PHY     []byte // encrypted, MIC'd LoRaWAN PHY payload
	FPort   uint8  // for priority and logging
	Queued  time.Time
	DevEUI  string // for logging
	Payload []byte // original cleartext payload (for logging/recording)
}

// DownlinkQueue holds pending downlinks per device, keyed by normalized DevEUI.
// Class A devices only receive downlinks in the RX1/RX2 window after an uplink,
// so API-triggered downlinks are queued here and drained when the next uplink arrives.
//
// Multiple downlinks per device are supported (e.g., AirConfig push + direct control
// both queued in the same uplink cycle). They are delivered in priority order over
// successive uplinks. Max depth per device is 12 to bound memory usage.
type DownlinkQueue struct {
	mu    sync.Mutex
	queue map[string][]pendingDownlink
}

const maxDownlinkQueueDepth = 12

// NewDownlinkQueue creates a new empty queue.
func NewDownlinkQueue() *DownlinkQueue {
	return &DownlinkQueue{queue: make(map[string][]pendingDownlink)}
}

// Enqueue adds a pre-built PHY frame to the device's pending queue.
// Items are kept sorted by priority (highest first); within the same priority,
// insertion order is preserved (stable sort). If the queue is full, the lowest-priority
// item is dropped to make room.
func (q *DownlinkQueue) Enqueue(devEUI string, fPort uint8, phyRaw []byte, clearPayload []byte) {
	q.mu.Lock()
	defer q.mu.Unlock()

	entry := pendingDownlink{
		PHY:     phyRaw,
		FPort:   fPort,
		Queued:  time.Now(),
		DevEUI:  devEUI,
		Payload: clearPayload,
	}

	pending := q.queue[devEUI]
	pending = append(pending, entry)

	// Stable sort by priority descending so same-priority items keep insertion order.
	sort.SliceStable(pending, func(i, j int) bool {
		return fportPriority(pending[i].FPort) > fportPriority(pending[j].FPort)
	})

	// Cap depth: drop the last (lowest priority) item if over limit.
	if len(pending) > maxDownlinkQueueDepth {
		dropped := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		log.Printf("downlink_queue: depth exceeded — dropped fPort=%d for dev_eui=%s", dropped.FPort, devEUI)
	}

	q.queue[devEUI] = pending
	log.Printf("downlink_queue: enqueued fPort=%d (priority=%d) for dev_eui=%s (queue depth=%d)",
		fPort, fportPriority(fPort), devEUI, len(pending))
}

// Drain returns and removes the highest-priority pending downlink for the device, or nil if none.
// Stale entries older than 10 minutes are purged first.
func (q *DownlinkQueue) Drain(devEUI string) *pendingDownlink {
	q.mu.Lock()
	defer q.mu.Unlock()

	pending := q.queue[devEUI]
	if len(pending) == 0 {
		return nil
	}

	// Purge stale entries from the front (highest priority first — if oldest is stale, rest likely are too).
	for len(pending) > 0 && time.Since(pending[0].Queued) > 10*time.Minute {
		log.Printf("downlink_queue: discarding stale fPort=%d for dev_eui=%s (queued %v ago)",
			pending[0].FPort, devEUI, time.Since(pending[0].Queued).Round(time.Second))
		pending = pending[1:]
	}

	if len(pending) == 0 {
		delete(q.queue, devEUI)
		return nil
	}

	dl := pending[0]
	pending = pending[1:]
	if len(pending) == 0 {
		delete(q.queue, devEUI)
	} else {
		q.queue[devEUI] = pending
	}
	return &dl
}

// Pending returns the count of devices with pending downlinks.
func (q *DownlinkQueue) Pending() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.queue)
}
