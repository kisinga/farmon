// Package node implements the shared sensor/downlink runtime loop.
// Both the RP2040 and LoRa-E5 targets build a node.Config and call node.Run().
// No machine import — all hardware access is through interfaces.
package node

import (
	"encoding/binary"
	"math"
	"time"

	"github.com/kisinga/farmon/firmware/pkg/actuator"
	"github.com/kisinga/farmon/firmware/pkg/airconfig"
	"github.com/kisinga/farmon/firmware/pkg/compute"
	"github.com/kisinga/farmon/firmware/pkg/rules"
	"github.com/kisinga/farmon/firmware/pkg/sensors"
	"github.com/kisinga/farmon/firmware/pkg/settings"
	"github.com/kisinga/farmon/firmware/pkg/transfer"
	"github.com/kisinga/farmon/firmware/pkg/transport"
	"github.com/kisinga/farmon/firmware/pkg/protocol"
)

// Config is provided by each target's main() to wire up the shared runtime.
type Config struct {
	Core         *settings.CoreSettings
	Transport    transport.Transport
	Actuators    [settings.MaxControls]actuator.Actuator
	Sensors      []sensors.Driver
	ActiveFields   []uint8                  // field indices to include in every periodic telemetry packet
	OnChangeFields []uint8                  // field indices sent only when the value changes
	Transfer       *transfer.FSM            // nil = disabled
	Extension    airconfig.ExtensionHandler // nil for RP2040
	SaveFn       func()
	RebootFn     func()

	// Firmware version reported in checkin (fPort 1). Set by each target's main().
	FWMajor, FWMinor, FWPatch uint8
}

// Node is the shared device runtime.
type Node struct {
	cfg              Config
	eng              *rules.Engine
	computeVM        compute.VM
	uptimeSec        uint32
	txCount          uint32
	rxCount          uint32
	checkinEvery     uint32    // send checkin every N TX intervals (set at init)
	prevOnChange     []float32 // last-sent values for OnChangeFields (indexed by position in OnChangeFields)
	prevOnChangeSet  bool      // whether prevOnChange has been initialised
}

// New creates a Node and loads the current rule set.
func New(cfg Config) *Node {
	n := &Node{cfg: cfg, checkinEvery: 10}
	n.eng = rules.New(func(ctrlIdx, stateIdx uint8) bool {
		if int(ctrlIdx) >= len(cfg.Actuators) || cfg.Actuators[ctrlIdx] == nil {
			return true
		}
		return cfg.Actuators[ctrlIdx].Set(stateIdx)
	})
	if cfg.Core.RuleCount > 0 {
		n.eng.LoadRules(cfg.Core.Rules[:cfg.Core.RuleCount])
		println("[node] loaded", cfg.Core.RuleCount, "rules")
	}
	if cfg.Core.ComputeCount > 0 {
		n.eng.MarkComputeWritable(cfg.Core.Compute[:], cfg.Core.ComputeCount)
		println("[node] loaded", cfg.Core.ComputeCount, "compute expressions")
	}
	return n
}

// Run is the main loop — reads sensors, evaluates rules, sends telemetry,
// and drains downlinks. Fully synchronous, no goroutines.
func (n *Node) Run() {
	for {
		time.Sleep(time.Duration(n.cfg.Core.TxIntervalSec) * time.Second)
		n.uptimeSec += uint32(n.cfg.Core.TxIntervalSec)

		values := n.readAllSensors()

		// Evaluate compute fields before rules so rules can reference computed values.
		if n.cfg.Core.ComputeCount > 0 {
			for i := uint8(0); i < n.cfg.Core.ComputeCount; i++ {
				fi := int(n.cfg.Core.Compute[i].FieldIdx)
				for len(values) <= fi {
					values = append(values, 0)
				}
			}
			n.computeVM.Evaluate(values, n.cfg.Core.Compute[:], n.cfg.Core.ComputeCount)
		}

		nowMs := uint32(time.Now().UnixNano() / 1e6)
		n.eng.Evaluate(values, nowMs)

		if n.cfg.Transfer != nil {
			tState := n.cfg.Transfer.Tick(values, nowMs)
			const transferFieldIdx = 6
			for len(values) <= transferFieldIdx {
				values = append(values, 0)
			}
			values[transferFieldIdx] = float32(tState)
		}

		n.txCount++
		if n.txCount%n.checkinEvery == 1 {
			n.sendCheckin()
		}

		n.sendTelemetry(values)
		n.sendOnChangeFields(values)
		n.sendStateChanges()

		// Drain any downlinks received during the TX/RX cycle.
		n.drainDownlinks()
	}
}

// drainDownlinks polls the transport for buffered downlink packets.
func (n *Node) drainDownlinks() {
	for {
		rx, ok := n.cfg.Transport.Recv()
		if !ok {
			return
		}
		n.rxCount++
		n.handleDownlink(rx)
	}
}

// --- Sensor reading ---

func (n *Node) readAllSensors() []float32 {
	var values []float32
	for _, s := range n.cfg.Sensors {
		for _, r := range s.Read() {
			if !r.Valid {
				continue
			}
			for len(values) <= int(r.FieldIndex) {
				values = append(values, 0)
			}
			values[r.FieldIndex] = r.Value
		}
	}
	return values
}

// maxFieldsPerPacket is the max telemetry fields that fit in one packet.
// Each field is 5 bytes (1B index + 4B float32), plus 1B count header.
const maxFieldsPerPacket = (transport.MaxPayload - 1) / 5 // 44

func (n *Node) sendTelemetry(values []float32) {
	fields := n.cfg.ActiveFields
	if len(fields) == 0 {
		return
	}
	for start := 0; start < len(fields); start += maxFieldsPerPacket {
		end := start + maxFieldsPerPacket
		if end > len(fields) {
			end = len(fields)
		}
		chunk := fields[start:end]

		var p transport.Packet
		p.Port = protocol.FPortTelemetry
		p.Payload[0] = uint8(len(chunk))
		off := 1
		for _, fi := range chunk {
			p.Payload[off] = fi
			if int(fi) < len(values) {
				binary.LittleEndian.PutUint32(p.Payload[off+1:], math.Float32bits(values[fi]))
			}
			off += 5
		}
		p.Len = uint8(off)
		n.cfg.Transport.Send(p)
	}
}

// sendOnChangeFields sends a telemetry packet containing only the on_change fields
// whose value has changed since the last transmission.
func (n *Node) sendOnChangeFields(values []float32) {
	fields := n.cfg.OnChangeFields
	if len(fields) == 0 {
		return
	}
	if !n.prevOnChangeSet {
		n.prevOnChange = make([]float32, len(fields))
		for i, fi := range fields {
			if int(fi) < len(values) {
				n.prevOnChange[i] = values[fi]
			}
		}
		n.prevOnChangeSet = true
		return // first reading: record baseline, do not transmit
	}
	// Collect only changed fields
	var changedIdx []uint8
	for i, fi := range fields {
		var cur float32
		if int(fi) < len(values) {
			cur = values[fi]
		}
		if cur != n.prevOnChange[i] {
			changedIdx = append(changedIdx, fi)
			n.prevOnChange[i] = cur
		}
	}
	if len(changedIdx) == 0 {
		return
	}
	n.sendTelemetry2(values, changedIdx)
}

// sendTelemetry2 sends a telemetry packet for an explicit list of field indices.
func (n *Node) sendTelemetry2(values []float32, fields []uint8) {
	for start := 0; start < len(fields); start += maxFieldsPerPacket {
		end := start + maxFieldsPerPacket
		if end > len(fields) {
			end = len(fields)
		}
		chunk := fields[start:end]

		var p transport.Packet
		p.Port = protocol.FPortTelemetry
		p.Payload[0] = uint8(len(chunk))
		off := 1
		for _, fi := range chunk {
			p.Payload[off] = fi
			if int(fi) < len(values) {
				binary.LittleEndian.PutUint32(p.Payload[off+1:], math.Float32bits(values[fi]))
			}
			off += 5
		}
		p.Len = uint8(off)
		n.cfg.Transport.Send(p)
	}
}

func (n *Node) sendStateChanges() {
	if !n.eng.HasPending() {
		return
	}
	var p transport.Packet
	p.Port = protocol.FPortStateChange
	size, count := n.eng.FormatBatch(p.Payload[:])
	if size > 0 {
		p.Len = uint8(size)
		if n.cfg.Transport.Send(p) {
			n.eng.ClearBatch(count)
		}
	}
}

// --- Downlink handling ---

func (n *Node) handleDownlink(rx transport.Packet) {
	data := rx.Payload[:rx.Len]

	switch rx.Port {

	case protocol.FPortCmdReset:
		n.txCount = 0
		n.rxCount = 0
		resetFlowCounters(n.cfg.Sensors)
		n.sendAck(rx.Port)

	case protocol.FPortCmdInterval:
		if rx.Len >= 2 {
			v := binary.LittleEndian.Uint16(data[:2])
			if v >= 10 && v <= 3600 {
				n.cfg.Core.TxIntervalSec = v
				n.cfg.SaveFn()
			}
		}
		n.sendAck(rx.Port)

	case protocol.FPortCmdReboot:
		n.sendAck(rx.Port)
		n.cfg.RebootFn()

	case protocol.FPortDirectCtrl:
		if rx.Len >= 2 {
			nowMs := uint32(time.Now().UnixNano() / 1e6)
			if n.cfg.Transfer != nil {
				n.cfg.Transfer.ForceIdle()
			}
			n.eng.SetState(data[0], data[1], rules.TriggerDownlink, 0, nowMs)
			if rx.Len >= 6 {
				n.eng.SetManualOverride(data[0], binary.LittleEndian.Uint32(data[2:6]), nowMs)
			}
		}
		n.sendAck(rx.Port)

	case protocol.FPortRuleUpdate:
		if rx.Len == 1 && data[0] == 0xFF {
			n.cfg.Core.RuleCount = 0
			n.eng.LoadRules(nil)
		} else {
			for off := 0; off+settings.RuleSize <= int(rx.Len); off += settings.RuleSize {
				var r settings.Rule
				if r.FromBinary(data[off:]) {
					n.upsertRule(&r)
				}
			}
			n.eng.LoadRules(n.cfg.Core.Rules[:n.cfg.Core.RuleCount])
		}
		n.cfg.SaveFn()
		n.sendAck(rx.Port)

	case protocol.FPortAirConfig:
		result := airconfig.Handle(n.cfg.Core, data, n.cfg.Extension)
		if result == airconfig.ResultSaved || result == airconfig.ResultReboot {
			n.cfg.SaveFn()
		}
		n.sendAck(rx.Port)
		if result == airconfig.ResultReboot {
			n.cfg.RebootFn()
		}
	}
}

func (n *Node) upsertRule(r *settings.Rule) {
	for i := uint8(0); i < n.cfg.Core.RuleCount; i++ {
		if n.cfg.Core.Rules[i].ID == r.ID {
			n.cfg.Core.Rules[i] = *r
			return
		}
	}
	if n.cfg.Core.RuleCount < settings.MaxRules {
		n.cfg.Core.Rules[n.cfg.Core.RuleCount] = *r
		n.cfg.Core.RuleCount++
	}
}

func (n *Node) sendAck(port uint8) {
	var p transport.Packet
	p.Port = protocol.FPortCommandAck
	p.Payload[0] = port
	p.Len = 1
	n.cfg.Transport.Send(p)
}

// sendCheckin sends a 14-byte fPort 1 registration/checkin packet.
func (n *Node) sendCheckin() {
	var p transport.Packet
	p.Port = protocol.FPortRegistration
	p.Payload[0] = n.cfg.FWMajor
	p.Payload[1] = n.cfg.FWMinor
	p.Payload[2] = n.cfg.FWPatch
	binary.LittleEndian.PutUint32(p.Payload[3:7], n.cfg.Core.ConfigHash)
	p.Payload[7] = 0 // preset_id (unused for now)
	binary.LittleEndian.PutUint32(p.Payload[8:12], n.uptimeSec)
	binary.LittleEndian.PutUint16(p.Payload[12:14], 0) // flags
	p.Len = 14
	n.cfg.Transport.Send(p)
}
