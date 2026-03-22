package main

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/kisinga/farmon/firmware/pkg/settings"
)

func f32Bytes(v float32) []byte {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], math.Float32bits(v))
	return b[:]
}

func TestCompileSimpleArithmetic(t *testing.T) {
	// f0 * 1.8 + 32
	bc, err := CompileExpression("f0 * 1.8 + 32")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Expected: LoadField(0), PushF32(1.8), Mul, PushF32(32), Add
	expected := []byte{
		byte(settings.OpLoadField), 0,
	}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(1.8)...)
	expected = append(expected, byte(settings.OpMul))
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(32)...)
	expected = append(expected, byte(settings.OpAdd))

	assertBytesEqual(t, expected, bc)
}

func TestCompileFieldRef(t *testing.T) {
	bc, err := CompileExpression("f5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 5}
	assertBytesEqual(t, expected, bc)
}

func TestCompileAvg(t *testing.T) {
	bc, err := CompileExpression("avg(f0, 8)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpWindowAvg), 8,
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileClamp(t *testing.T) {
	bc, err := CompileExpression("clamp(f0, 0, 100)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 0, byte(settings.OpClamp)}
	expected = append(expected, f32Bytes(0)...)
	expected = append(expected, f32Bytes(100)...)
	assertBytesEqual(t, expected, bc)
}

func TestCompileAccum(t *testing.T) {
	bc, err := CompileExpression("accum(f3)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 3,
		byte(settings.OpAccum),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileMin(t *testing.T) {
	bc, err := CompileExpression("min(f0, f1)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpLoadField), 1,
		byte(settings.OpMin2),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileMax(t *testing.T) {
	bc, err := CompileExpression("max(f0, f1)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpLoadField), 1,
		byte(settings.OpMax2),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileAbs(t *testing.T) {
	bc, err := CompileExpression("abs(f0 - f1)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpLoadField), 1,
		byte(settings.OpSub),
		byte(settings.OpAbs),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileComparison(t *testing.T) {
	bc, err := CompileExpression("gt(f0, 25)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 0}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(25)...)
	expected = append(expected, byte(settings.OpCmpGT))
	assertBytesEqual(t, expected, bc)
}

func TestCompileNested(t *testing.T) {
	// clamp(f0 * 1.8 + 32, 0, 212)
	bc, err := CompileExpression("clamp(f0 * 1.8 + 32, 0, 212)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// LoadField(0), PushF32(1.8), Mul, PushF32(32), Add, Clamp(0, 212)
	expected := []byte{byte(settings.OpLoadField), 0}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(1.8)...)
	expected = append(expected, byte(settings.OpMul))
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(32)...)
	expected = append(expected, byte(settings.OpAdd))
	expected = append(expected, byte(settings.OpClamp))
	expected = append(expected, f32Bytes(0)...)
	expected = append(expected, f32Bytes(212)...)
	assertBytesEqual(t, expected, bc)
}

func TestCompileUnaryNeg(t *testing.T) {
	bc, err := CompileExpression("-f0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpNeg),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileParens(t *testing.T) {
	// (f0 + f1) * 2
	bc, err := CompileExpression("(f0 + f1) * 2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpLoadField), 1,
		byte(settings.OpAdd),
	}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(2)...)
	expected = append(expected, byte(settings.OpMul))
	assertBytesEqual(t, expected, bc)
}

// ─── Error cases ────────────────────────────────────────────────────────────

func TestCompileEmpty(t *testing.T) {
	_, err := CompileExpression("")
	if err == nil {
		t.Fatal("expected error for empty expression")
	}
}

func TestCompileUnknownFunc(t *testing.T) {
	_, err := CompileExpression("foobar(f0)")
	if err == nil {
		t.Fatal("expected error for unknown function")
	}
}

func TestCompileAvgBadWindow(t *testing.T) {
	_, err := CompileExpression("avg(f0, 20)")
	if err == nil {
		t.Fatal("expected error for window size > 16")
	}
}

func TestCompileWrongArgCount(t *testing.T) {
	_, err := CompileExpression("min(f0)")
	if err == nil {
		t.Fatal("expected error for wrong arg count")
	}
}

// ─── New opcodes: mod, select, delta ────────────────────────────────────────

func TestCompileMod(t *testing.T) {
	bc, err := CompileExpression("mod(f0, 60)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 0}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(60)...)
	expected = append(expected, byte(settings.OpMod))
	assertBytesEqual(t, expected, bc)
}

func TestCompileModInfix(t *testing.T) {
	bc, err := CompileExpression("f0 % 60")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 0}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(60)...)
	expected = append(expected, byte(settings.OpMod))
	assertBytesEqual(t, expected, bc)
}

func TestCompileSelect(t *testing.T) {
	bc, err := CompileExpression("select(gt(f0, 100), f1, f2)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{byte(settings.OpLoadField), 0}
	expected = append(expected, byte(settings.OpPushF32))
	expected = append(expected, f32Bytes(100)...)
	expected = append(expected, byte(settings.OpCmpGT))
	expected = append(expected, byte(settings.OpLoadField), 1)
	expected = append(expected, byte(settings.OpLoadField), 2)
	expected = append(expected, byte(settings.OpSelect))
	assertBytesEqual(t, expected, bc)
}

func TestCompileDelta(t *testing.T) {
	bc, err := CompileExpression("delta(f0)")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []byte{
		byte(settings.OpLoadField), 0,
		byte(settings.OpDelta),
	}
	assertBytesEqual(t, expected, bc)
}

func TestCompileSelectWrongArgs(t *testing.T) {
	_, err := CompileExpression("select(f0, f1)")
	if err == nil {
		t.Fatal("expected error for select() with 2 args")
	}
}

func TestCompileDeltaWrongArgs(t *testing.T) {
	_, err := CompileExpression("delta(f0, f1)")
	if err == nil {
		t.Fatal("expected error for delta() with 2 args")
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func assertBytesEqual(t *testing.T, expected, actual []byte) {
	t.Helper()
	if len(expected) != len(actual) {
		t.Fatalf("bytecode length mismatch: expected %d, got %d\nexpected: %x\nactual:   %x", len(expected), len(actual), expected, actual)
	}
	for i := range expected {
		if expected[i] != actual[i] {
			t.Fatalf("bytecode mismatch at byte %d: expected 0x%02x, got 0x%02x\nexpected: %x\nactual:   %x", i, expected[i], actual[i], expected, actual)
		}
	}
}
