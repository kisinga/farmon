package compute

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/kisinga/farmon/firmware/pkg/settings"
)

// helper to encode a float32 as 4 LE bytes
func f32Bytes(v float32) []byte {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], math.Float32bits(v))
	return b[:]
}

func TestVMAdd(t *testing.T) {
	var vm VM
	code := []byte{
		byte(settings.OpPushF32)}
	code = append(code, f32Bytes(3)...)
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(7)...)
	code = append(code, byte(settings.OpAdd))

	var state State
	result := vm.execute(code, nil, &state)
	if result != 10 {
		t.Errorf("expected 10, got %f", result)
	}
}

func TestVMDivByZero(t *testing.T) {
	var vm VM
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(5)...)
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(0)...)
	code = append(code, byte(settings.OpDiv))

	var state State
	result := vm.execute(code, nil, &state)
	if result != 0 {
		t.Errorf("expected 0, got %f", result)
	}
}

func TestVMMod(t *testing.T) {
	var vm VM

	tests := []struct {
		a, b, want float32
	}{
		{10, 3, 1},
		{10.5, 3, 1.5},
		{7, 7, 0},
		{-10, 3, -1},
	}

	for _, tc := range tests {
		code := []byte{byte(settings.OpPushF32)}
		code = append(code, f32Bytes(tc.a)...)
		code = append(code, byte(settings.OpPushF32))
		code = append(code, f32Bytes(tc.b)...)
		code = append(code, byte(settings.OpMod))

		var state State
		result := vm.execute(code, nil, &state)
		if math.Abs(float64(result-tc.want)) > 0.001 {
			t.Errorf("mod(%v, %v): expected %v, got %v", tc.a, tc.b, tc.want, result)
		}
	}
}

func TestVMModByZero(t *testing.T) {
	var vm VM
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(10)...)
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(0)...)
	code = append(code, byte(settings.OpMod))

	var state State
	result := vm.execute(code, nil, &state)
	if result != 0 {
		t.Errorf("expected 0, got %f", result)
	}
}

func TestVMSelect(t *testing.T) {
	var vm VM

	// condition true (1.0) → should return ifTrue (10)
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(1)...) // cond
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(10)...) // ifTrue
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(20)...) // ifFalse
	code = append(code, byte(settings.OpSelect))

	var state State
	result := vm.execute(code, nil, &state)
	if result != 10 {
		t.Errorf("select true: expected 10, got %f", result)
	}

	// condition false (0.0) → should return ifFalse (20)
	code2 := []byte{byte(settings.OpPushF32)}
	code2 = append(code2, f32Bytes(0)...) // cond
	code2 = append(code2, byte(settings.OpPushF32))
	code2 = append(code2, f32Bytes(10)...) // ifTrue
	code2 = append(code2, byte(settings.OpPushF32))
	code2 = append(code2, f32Bytes(20)...) // ifFalse
	code2 = append(code2, byte(settings.OpSelect))

	result = vm.execute(code2, nil, &state)
	if result != 20 {
		t.Errorf("select false: expected 20, got %f", result)
	}
}

func TestVMSelectNegativeCondition(t *testing.T) {
	var vm VM

	// negative nonzero is truthy
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(-5)...) // cond (truthy)
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(10)...) // ifTrue
	code = append(code, byte(settings.OpPushF32))
	code = append(code, f32Bytes(20)...) // ifFalse
	code = append(code, byte(settings.OpSelect))

	var state State
	result := vm.execute(code, nil, &state)
	if result != 10 {
		t.Errorf("select negative condition: expected 10, got %f", result)
	}
}

func TestVMDelta(t *testing.T) {
	var vm VM
	values := []float32{100}

	// Build a program: delta(f0)
	var slot settings.ComputeSlot
	slot.FieldIdx = 1
	slot.Bytecode[0] = byte(settings.OpLoadField)
	slot.Bytecode[1] = 0 // f0
	slot.Bytecode[2] = byte(settings.OpDelta)
	slot.BytecodeLen = 3

	programs := []settings.ComputeSlot{slot}

	// First cycle: delta should be 0 (no previous value)
	vals := []float32{100, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 0 {
		t.Errorf("delta first cycle: expected 0, got %f", vals[1])
	}

	// Second cycle: f0 changed to 115, delta should be 15
	vals = []float32{115, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 15 {
		t.Errorf("delta second cycle: expected 15, got %f", vals[1])
	}

	// Third cycle: f0 dropped to 110, delta should be -5
	vals = []float32{110, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != -5 {
		t.Errorf("delta third cycle: expected -5, got %f", vals[1])
	}

	_ = values // suppress unused
}

func TestVMAccum(t *testing.T) {
	var vm VM

	var slot settings.ComputeSlot
	slot.FieldIdx = 1
	slot.Bytecode[0] = byte(settings.OpLoadField)
	slot.Bytecode[1] = 0 // f0
	slot.Bytecode[2] = byte(settings.OpAccum)
	slot.BytecodeLen = 3

	programs := []settings.ComputeSlot{slot}

	vals := []float32{5, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 5 {
		t.Errorf("accum cycle 1: expected 5, got %f", vals[1])
	}

	vals = []float32{3, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 8 {
		t.Errorf("accum cycle 2: expected 8, got %f", vals[1])
	}

	vals = []float32{2, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 10 {
		t.Errorf("accum cycle 3: expected 10, got %f", vals[1])
	}
}

func TestVMWindowAvg(t *testing.T) {
	var vm VM

	var slot settings.ComputeSlot
	slot.FieldIdx = 1
	slot.Bytecode[0] = byte(settings.OpLoadField)
	slot.Bytecode[1] = 0 // f0
	slot.Bytecode[2] = byte(settings.OpWindowAvg)
	slot.Bytecode[3] = 3 // window size = 3
	slot.BytecodeLen = 4

	programs := []settings.ComputeSlot{slot}

	// Push values: 10, 20, 30
	vals := []float32{10, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 10 { // avg of [10] = 10
		t.Errorf("window cycle 1: expected 10, got %f", vals[1])
	}

	vals = []float32{20, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 15 { // avg of [10, 20] = 15
		t.Errorf("window cycle 2: expected 15, got %f", vals[1])
	}

	vals = []float32{30, 0}
	vm.Evaluate(vals, programs, 1)
	if vals[1] != 20 { // avg of [10, 20, 30] = 20
		t.Errorf("window cycle 3: expected 20, got %f", vals[1])
	}

	// Window full, oldest value (10) dropped
	vals = []float32{60, 0}
	vm.Evaluate(vals, programs, 1)
	// Window now: [60, 20, 30] → avg = 110/3 ≈ 36.67
	expected := float32(110) / 3
	if math.Abs(float64(vals[1]-expected)) > 0.01 {
		t.Errorf("window cycle 4: expected ~%f, got %f", expected, vals[1])
	}
}

func TestVMStackOverflow(t *testing.T) {
	var vm VM
	// Push 9 values (stack max = 8), the 9th should be silently dropped
	var code []byte
	for i := 0; i < 9; i++ {
		code = append(code, byte(settings.OpPushF32))
		code = append(code, f32Bytes(float32(i))...)
	}

	var state State
	result := vm.execute(code, nil, &state)
	// Top of stack should be the 8th value pushed (index 7)
	if result != 7 {
		t.Errorf("stack overflow: expected 7, got %f", result)
	}
}

func TestVMUnknownOpcode(t *testing.T) {
	var vm VM
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(42)...)
	code = append(code, 0xFF) // unknown opcode

	var state State
	result := vm.execute(code, nil, &state)
	if result != 42 {
		t.Errorf("unknown opcode: expected 42, got %f", result)
	}
}

func TestVMLoadField(t *testing.T) {
	var vm VM
	values := []float32{1.5, 2.5, 3.5}

	code := []byte{
		byte(settings.OpLoadField), 1, // push values[1]
		byte(settings.OpLoadField), 2, // push values[2]
		byte(settings.OpMul),
	}

	var state State
	result := vm.execute(code, values, &state)
	if math.Abs(float64(result-8.75)) > 0.001 {
		t.Errorf("expected 8.75, got %f", result)
	}
}

func TestVMClamp(t *testing.T) {
	var vm VM

	// value 150, clamp to [0, 100] → 100
	code := []byte{byte(settings.OpPushF32)}
	code = append(code, f32Bytes(150)...)
	code = append(code, byte(settings.OpClamp))
	code = append(code, f32Bytes(0)...)
	code = append(code, f32Bytes(100)...)

	var state State
	result := vm.execute(code, nil, &state)
	if result != 100 {
		t.Errorf("clamp high: expected 100, got %f", result)
	}

	// value -5, clamp to [0, 100] → 0
	code2 := []byte{byte(settings.OpPushF32)}
	code2 = append(code2, f32Bytes(-5)...)
	code2 = append(code2, byte(settings.OpClamp))
	code2 = append(code2, f32Bytes(0)...)
	code2 = append(code2, f32Bytes(100)...)

	result = vm.execute(code2, nil, &state)
	if result != 0 {
		t.Errorf("clamp low: expected 0, got %f", result)
	}
}

func TestVMComparison(t *testing.T) {
	var vm VM

	tests := []struct {
		op   settings.ComputeOpcode
		a, b float32
		want float32
	}{
		{settings.OpCmpGT, 10, 5, 1},
		{settings.OpCmpGT, 5, 10, 0},
		{settings.OpCmpLT, 5, 10, 1},
		{settings.OpCmpLT, 10, 5, 0},
		{settings.OpCmpGTE, 10, 10, 1},
		{settings.OpCmpGTE, 9, 10, 0},
		{settings.OpCmpLTE, 10, 10, 1},
		{settings.OpCmpLTE, 11, 10, 0},
	}

	for _, tc := range tests {
		code := []byte{byte(settings.OpPushF32)}
		code = append(code, f32Bytes(tc.a)...)
		code = append(code, byte(settings.OpPushF32))
		code = append(code, f32Bytes(tc.b)...)
		code = append(code, byte(tc.op))

		var state State
		result := vm.execute(code, nil, &state)
		if result != tc.want {
			t.Errorf("cmp op=0x%02x(%v,%v): expected %v, got %v", tc.op, tc.a, tc.b, tc.want, result)
		}
	}
}

func TestVMSelectWithComparison(t *testing.T) {
	// Realistic: select(gt(f0, 100), f1, f2)
	var vm VM
	values := []float32{150, 10, 20}

	code := []byte{
		byte(settings.OpLoadField), 0, // f0
		byte(settings.OpPushF32),
	}
	code = append(code, f32Bytes(100)...)
	code = append(code, byte(settings.OpCmpGT)) // gt(f0, 100) → 1
	code = append(code, byte(settings.OpLoadField), 1) // f1
	code = append(code, byte(settings.OpLoadField), 2) // f2
	code = append(code, byte(settings.OpSelect))

	var state State
	result := vm.execute(code, values, &state)
	if result != 10 {
		t.Errorf("select(gt(150,100), 10, 20): expected 10, got %f", result)
	}

	// Now with f0=50 (condition false)
	values[0] = 50
	result = vm.execute(code, values, &state)
	if result != 20 {
		t.Errorf("select(gt(50,100), 10, 20): expected 20, got %f", result)
	}
}
