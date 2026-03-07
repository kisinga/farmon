package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	fPortDirectControl = 20
	defaultHTTPTimeout = 10 * time.Second
)

// ChirpStack client for downlink enqueue and gateway list (HTTP REST).
// Set CHIRPSTACK_API_URL (e.g. http://chirpstack-rest-api:8090) and CHIRPSTACK_API_KEY.
// If unset, Enqueue and ListGateways no-op and return nil/empty (caller can stub).
type ChirpStackClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewChirpStackClient() *ChirpStackClient {
	base := strings.TrimSuffix(os.Getenv("CHIRPSTACK_API_URL"), "/")
	key := os.Getenv("CHIRPSTACK_API_KEY")
	return &ChirpStackClient{
		baseURL:    base,
		apiKey:     key,
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
	}
}

func (c *ChirpStackClient) Enabled() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// EnqueueDownlink sends a downlink to the device queue (fPort 20 = direct control).
// Payload is 7 bytes: [control_idx, state_idx, is_manual, timeout_sec LE 4B].
func (c *ChirpStackClient) EnqueueDownlink(devEui string, payload []byte) error {
	if !c.Enabled() {
		return nil
	}
	// Normalize EUI to 16-char hex (no separators) for API
	eui := normalizeEuiForAPI(devEui)
	url := c.baseURL + "/api/devices/" + eui + "/queue"

	// ChirpStack REST API (grpc-gateway) uses camelCase in JSON.
	body := map[string]any{
		"queueItem": map[string]any{
			"devEui":    eui,
			"fPort":     fPortDirectControl,
			"confirmed": false,
			"data":      base64.StdEncoding.EncodeToString(payload),
		},
	}
	enc, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(enc))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	// ChirpStack REST proxy may expect gRPC gateway header
	req.Header.Set("Grpc-Metadata-Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("chirpstack enqueue: %s: %s", resp.Status, string(b))
	}
	return nil
}

// GatewaySummary holds one gateway's status for the UI.
type GatewaySummary struct {
	ID        string  `json:"id"`
	Name      string  `json:"name,omitempty"`
	Online    bool    `json:"online"`
	LastSeen  *string `json:"lastSeen,omitempty"`
}

// ListGateways returns gateways (id, name, online, lastSeen). Empty if client disabled or API error.
func (c *ChirpStackClient) ListGateways() ([]GatewaySummary, error) {
	if !c.Enabled() {
		return []GatewaySummary{}, nil
	}
	// ChirpStack REST: list gateways (path may be /api/gateways or tenant-scoped)
	url := c.baseURL + "/api/gateways?limit=100"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Grpc-Metadata-Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return []GatewaySummary{}, nil
	}

	var out struct {
		Result []struct {
			GatewayId string `json:"gatewayId"`
			Name      string `json:"name"`
			// Connection state may be in a different field; adapt to actual API
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return []GatewaySummary{}, nil
	}
	list := make([]GatewaySummary, 0, len(out.Result))
	for _, g := range out.Result {
		list = append(list, GatewaySummary{
			ID:     g.GatewayId,
			Name:   g.Name,
			Online: false, // Set when API provides connection state
		})
	}
	return list, nil
}

func normalizeEuiForAPI(eui string) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 16)
	for _, c := range eui {
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			out = append(out, byte(c))
		} else if c >= 'A' && c <= 'F' {
			out = append(out, byte(c-'A'+'a'))
		}
	}
	if len(out) > 16 {
		out = out[:16]
	}
	return string(out)
}

// BuildDirectControlPayload returns 7 bytes for codec fPort 20: [control_idx, state_idx, is_manual, timeout_sec LE].
func BuildDirectControlPayload(controlIdx, stateIdx int, timeoutSec uint32) []byte {
	return []byte{
		byte(controlIdx),
		byte(stateIdx),
		1, // is_manual
		byte(timeoutSec),
		byte(timeoutSec >> 8),
		byte(timeoutSec >> 16),
		byte(timeoutSec >> 24),
	}
}
