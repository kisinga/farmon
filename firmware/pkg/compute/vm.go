// Package compute implements a stack-based bytecode VM for computed fields.
// Expressions are compiled on the backend and pushed to the device as bytecode.
// The VM evaluates each compute field every compute cycle, writing results
// back to the unified field values array.
package compute

import (
	"encoding/binary"
	"math"

	"github.com/kisinga/farmon/firmware/pkg/settings"
)

const maxStack = 8

// State holds persistent per-field state for stateful opcodes (ACCUMULATE, WINDOW_AVG).
type State struct {
	Accum     float32
	Window    [16]float32 // ring buffer for rolling average
	WindowPos uint8
	WindowLen uint8 // configured window size
}

// VM is the compute engine that evaluates bytecode programs against field values.
type VM struct {
	stack [maxStack]float32
	sp    int

	// Per-field persistent state (indexed by compute slot, not field index).
	States [settings.MaxCompute]State
}

// Evaluate runs all compute programs, writing results to the values array.
// Programs MUST be ordered by field index (low to high) so that a compute field
// can reference earlier compute fields without cycles.
func (vm *VM) Evaluate(values []float32, programs []settings.ComputeSlot, count uint8) {
	for i := uint8(0); i < count; i++ {
		p := &programs[i]
		if p.BytecodeLen == 0 {
			continue
		}
		result := vm.execute(p.Bytecode[:p.BytecodeLen], values, &vm.States[i])
		if int(p.FieldIdx) < len(values) {
			values[p.FieldIdx] = result
		}
	}
}

func (vm *VM) execute(code []byte, values []float32, state *State) float32 {
	vm.sp = 0
	pc := 0

	for pc < len(code) {
		op := settings.ComputeOpcode(code[pc])
		pc++

		switch op {
		case settings.OpLoadField:
			if pc >= len(code) {
				return 0
			}
			idx := code[pc]
			pc++
			v := float32(0)
			if int(idx) < len(values) {
				v = values[idx]
			}
			vm.push(v)

		case settings.OpPushF32:
			if pc+4 > len(code) {
				return 0
			}
			bits := binary.LittleEndian.Uint32(code[pc : pc+4])
			pc += 4
			vm.push(math.Float32frombits(bits))

		case settings.OpAdd:
			b, a := vm.pop(), vm.pop()
			vm.push(a + b)
		case settings.OpSub:
			b, a := vm.pop(), vm.pop()
			vm.push(a - b)
		case settings.OpMul:
			b, a := vm.pop(), vm.pop()
			vm.push(a * b)
		case settings.OpDiv:
			b, a := vm.pop(), vm.pop()
			if b != 0 {
				vm.push(a / b)
			} else {
				vm.push(0)
			}

		case settings.OpCmpGT:
			b, a := vm.pop(), vm.pop()
			vm.push(boolF(a > b))
		case settings.OpCmpLT:
			b, a := vm.pop(), vm.pop()
			vm.push(boolF(a < b))
		case settings.OpCmpGTE:
			b, a := vm.pop(), vm.pop()
			vm.push(boolF(a >= b))
		case settings.OpCmpLTE:
			b, a := vm.pop(), vm.pop()
			vm.push(boolF(a <= b))

		case settings.OpMin2:
			b, a := vm.pop(), vm.pop()
			if a < b {
				vm.push(a)
			} else {
				vm.push(b)
			}
		case settings.OpMax2:
			b, a := vm.pop(), vm.pop()
			if a > b {
				vm.push(a)
			} else {
				vm.push(b)
			}

		case settings.OpAbs:
			v := vm.pop()
			if v < 0 {
				v = -v
			}
			vm.push(v)
		case settings.OpNeg:
			vm.push(-vm.pop())

		case settings.OpAccum:
			v := vm.pop()
			state.Accum += v
			vm.push(state.Accum)

		case settings.OpWindowAvg:
			if pc >= len(code) {
				return 0
			}
			n := code[pc]
			pc++
			if n == 0 || n > 16 {
				n = 16
			}
			v := vm.pop()
			state.WindowLen = n
			state.Window[state.WindowPos%n] = v
			state.WindowPos++
			// Compute average of filled entries
			filled := state.WindowPos
			if filled > uint8(n) {
				filled = n
			}
			var sum float32
			for j := uint8(0); j < filled; j++ {
				sum += state.Window[j%n]
			}
			vm.push(sum / float32(filled))

		case settings.OpClamp:
			if pc+8 > len(code) {
				return 0
			}
			minBits := binary.LittleEndian.Uint32(code[pc : pc+4])
			maxBits := binary.LittleEndian.Uint32(code[pc+4 : pc+8])
			pc += 8
			lo := math.Float32frombits(minBits)
			hi := math.Float32frombits(maxBits)
			v := vm.pop()
			if v < lo {
				v = lo
			}
			if v > hi {
				v = hi
			}
			vm.push(v)

		default:
			// Unknown opcode — stop execution
			return vm.top()
		}
	}

	return vm.top()
}

func (vm *VM) push(v float32) {
	if vm.sp < maxStack {
		vm.stack[vm.sp] = v
		vm.sp++
	}
}

func (vm *VM) pop() float32 {
	if vm.sp > 0 {
		vm.sp--
		return vm.stack[vm.sp]
	}
	return 0
}

func (vm *VM) top() float32 {
	if vm.sp > 0 {
		return vm.stack[vm.sp-1]
	}
	return 0
}

func boolF(b bool) float32 {
	if b {
		return 1.0
	}
	return 0.0
}
