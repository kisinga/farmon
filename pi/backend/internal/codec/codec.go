package codec

import (
	"fmt"
	"os"
	"sync"

	"github.com/dop251/goja"
)

// Runner runs the Farm Monitor codec (decodeUplink / encodeDownlink) in a goja VM.
type Runner struct {
	vm   *goja.Runtime
	mu   sync.Mutex
	path string
}

// NewRunner loads the codec script from path (e.g. "codec.js" or CODEC_PATH).
// If path is empty, uses CODEC_PATH env or "codec.js".
func NewRunner(path string) (*Runner, error) {
	if path == "" {
		path = os.Getenv("CODEC_PATH")
	}
	if path == "" {
		path = "codec.js"
	}
	script, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("codec load %s: %w", path, err)
	}
	vm := goja.New()
	if _, err := vm.RunString(string(script)); err != nil {
		return nil, fmt.Errorf("codec run: %w", err)
	}
	return &Runner{vm: vm, path: path}, nil
}

// DecodeUplink runs decodeUplink({ fPort, bytes }) and returns the "data" object as a map.
// bytes are the raw payload bytes; the codec may use them as text (String.fromCharCode).
func (r *Runner) DecodeUplink(fPort uint8, bytes []byte) (map[string]interface{}, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Convert bytes to []interface{} for JS (array of numbers for String.fromCharCode)
	byteArr := make([]interface{}, len(bytes))
	for i, b := range bytes {
		byteArr[i] = int64(b)
	}
	input := map[string]interface{}{
		"fPort": int64(fPort),
		"bytes": byteArr,
	}
	fn, ok := goja.AssertFunction(r.vm.Get("decodeUplink"))
	if !ok {
		return nil, fmt.Errorf("decodeUplink not found")
	}
	obj := r.vm.ToValue(input)
	res, err := fn(goja.Undefined(), obj)
	if err != nil {
		return nil, err
	}
	resObj, ok := res.Export().(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("decodeUplink did not return object")
	}
	data, _ := resObj["data"].(map[string]interface{})
	return data, nil
}

// EncodeDownlink runs encodeDownlink({ fPort, data }) and returns the "bytes" array.
func (r *Runner) EncodeDownlink(fPort uint8, data map[string]interface{}) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	input := map[string]interface{}{
		"fPort": int64(fPort),
		"data":  data,
	}
	fn, ok := goja.AssertFunction(r.vm.Get("encodeDownlink"))
	if !ok {
		return nil, fmt.Errorf("encodeDownlink not found")
	}
	obj := r.vm.ToValue(input)
	res, err := fn(goja.Undefined(), obj)
	if err != nil {
		return nil, err
	}
	resObj, ok := res.Export().(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("encodeDownlink did not return object")
	}
	bytesRaw := resObj["bytes"]
	if bytesRaw == nil {
		return []byte{}, nil
	}
	bytesArr, ok := bytesRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("encodeDownlink bytes not array")
	}
	out := make([]byte, 0, len(bytesArr))
	for _, v := range bytesArr {
		switch n := v.(type) {
		case int64:
			out = append(out, byte(n))
		case int:
			out = append(out, byte(n))
		default:
			return nil, fmt.Errorf("encodeDownlink byte element not number")
		}
	}
	return out, nil
}
