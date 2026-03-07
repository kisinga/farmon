package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/api"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	fPortDirectControl = 20
	defaultRPCTimeout  = 10 * time.Second
)

// apiToken implements credentials.PerRPCCredentials for ChirpStack gRPC auth.
type apiToken string

func (a apiToken) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	return map[string]string{
		"authorization": "Bearer " + string(a),
	}, nil
}

func (a apiToken) RequireTransportSecurity() bool {
	return false
}

// ChirpStack client for downlink enqueue and gateway list (gRPC).
// Set CHIRPSTACK_GRPC_ADDR (e.g. chirpstack:8080) and CHIRPSTACK_API_KEY.
// If unset, Enqueue and ListGateways no-op and return nil/empty (caller can stub).
type ChirpStackClient struct {
	addr   string
	apiKey string

	once sync.Once
	conn *grpc.ClientConn
	err  error

	deviceClient  api.DeviceServiceClient
	gatewayClient api.GatewayServiceClient
}

func NewChirpStackClient() *ChirpStackClient {
	addr := strings.TrimSpace(os.Getenv("CHIRPSTACK_GRPC_ADDR"))
	key := os.Getenv("CHIRPSTACK_API_KEY")
	return &ChirpStackClient{
		addr:   addr,
		apiKey: key,
	}
}

func (c *ChirpStackClient) Enabled() bool {
	return c.addr != "" && c.apiKey != ""
}

func (c *ChirpStackClient) ensureConn() (*grpc.ClientConn, error) {
	c.once.Do(func() {
		c.conn, c.err = grpc.NewClient(c.addr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithPerRPCCredentials(apiToken(c.apiKey)),
		)
		if c.err != nil {
			return
		}
		c.deviceClient = api.NewDeviceServiceClient(c.conn)
		c.gatewayClient = api.NewGatewayServiceClient(c.conn)
	})
	return c.conn, c.err
}

// EnqueueDownlink sends a downlink to the device queue (fPort 20 = direct control).
// Payload is 7 bytes: [control_idx, state_idx, is_manual, timeout_sec LE 4B].
func (c *ChirpStackClient) EnqueueDownlink(devEui string, payload []byte) error {
	if !c.Enabled() {
		return nil
	}
	_, err := c.ensureConn()
	if err != nil {
		return fmt.Errorf("chirpstack gRPC: %w", err)
	}

	eui := normalizeEuiForAPI(devEui)
	ctx, cancel := context.WithTimeout(context.Background(), defaultRPCTimeout)
	defer cancel()

	_, err = c.deviceClient.Enqueue(ctx, &api.EnqueueDeviceQueueItemRequest{
		QueueItem: &api.DeviceQueueItem{
			DevEui:    eui,
			FPort:     fPortDirectControl,
			Confirmed: false,
			Data:      payload,
		},
	})
	if err != nil {
		return fmt.Errorf("chirpstack enqueue: %w", err)
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
	_, err := c.ensureConn()
	if err != nil {
		return []GatewaySummary{}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultRPCTimeout)
	defer cancel()

	resp, err := c.gatewayClient.List(ctx, &api.ListGatewaysRequest{
		Limit: 100,
	})
	if err != nil {
		return []GatewaySummary{}, nil
	}

	list := make([]GatewaySummary, 0, len(resp.Result))
	for _, g := range resp.Result {
		summary := GatewaySummary{
			ID:     g.GetGatewayId(),
			Name:   g.GetName(),
			Online: g.GetState() == api.GatewayState_ONLINE,
		}
		if ts := g.GetLastSeenAt(); ts != nil {
			if t := ts.AsTime(); !t.IsZero() {
				s := t.Format(time.RFC3339)
				summary.LastSeen = &s
			}
		}
		list = append(list, summary)
	}
	return list, nil
}

func normalizeEuiForAPI(eui string) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 16)
	for _, ch := range eui {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') {
			out = append(out, byte(ch))
		} else if ch >= 'A' && ch <= 'F' {
			out = append(out, byte(ch-'A'+'a'))
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
