// Package concentratord implements the ChirpStack Concentratord ZMQ API.
// Commands (REQ): frame0 = command string, frame1 = Protobuf payload.
// Events (SUB): frame0 = event type ("up" | "stats"), frame1 = Protobuf payload.
// See https://www.chirpstack.io/docs/chirpstack-concentratord/api/commands.html and docs/concentratord-api.md.
package concentratord

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"github.com/go-zeromq/zmq4"
	"google.golang.org/protobuf/proto"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

const (
	eventTypeUp       = "up"
	dialRetryEvery    = 5 * time.Second
	unmarshalLogEvery = 5 * time.Minute
)

var (
	lastUnmarshalLog   time.Time
	unmarshalLogMu     sync.Mutex
)

// parseUplinkEvent returns the UplinkFrame from a ZMQ message (topic+body or body only).
// Supports both gw.Event (concentratord) and raw gw.UplinkFrame (e.g. gateway bridge).
func parseUplinkEvent(msg zmq4.Msg) *gw.UplinkFrame {
	frames := msg.Frames
	if len(frames) == 0 {
		return nil
	}
	payload := frames[0]
	if len(frames) >= 2 && string(frames[0]) == eventTypeUp {
		payload = frames[1]
	}
	// Try Event first (concentratord sends Event{ event: UplinkFrame }).
	var ev gw.Event
	if err := proto.Unmarshal(payload, &ev); err == nil {
		if uf := ev.GetUplinkFrame(); uf != nil {
			return uf
		}
	}
	// Fallback: raw UplinkFrame (e.g. gateway bridge or proxy).
	var uf gw.UplinkFrame
	if err := proto.Unmarshal(payload, &uf); err == nil && len(uf.GetPhyPayload()) > 0 {
		return &uf
	}
	// Rate-limit unmarshal failure logs.
	unmarshalLogMu.Lock()
	now := time.Now()
	shouldLog := now.Sub(lastUnmarshalLog) >= unmarshalLogEvery
	if shouldLog {
		lastUnmarshalLog = now
	}
	unmarshalLogMu.Unlock()
	if shouldLog {
		log.Printf("concentratord event: payload is neither Event nor UplinkFrame (len=%d)", len(payload))
	}
	return nil
}

// Client implements gateway.UplinkSource and gateway.DownlinkSender using
// Concentratord ZMQ (SUB for events, REQ for commands).
type Client struct {
	eventURL    string
	commandURL  string
	sub         zmq4.Socket
	req         zmq4.Socket
	subOnce     sync.Once
	reqOnce     sync.Once
	subErr      error
	reqErr      error
	reqMu       sync.Mutex
}

// NewClient creates a client. eventURL and commandURL are ZMQ endpoints
// (e.g. "ipc:///var/run/concentratord/event_bind").
// If either is empty, the client is disabled.
func NewClient(eventURL, commandURL string) *Client {
	return &Client{
		eventURL:   strings.TrimSpace(eventURL),
		commandURL: strings.TrimSpace(commandURL),
	}
}

// NewClientFromEnv creates a client from CONCENTRATORD_EVENT_URL and CONCENTRATORD_COMMAND_URL.
func NewClientFromEnv() *Client {
	return NewClient(
		os.Getenv("CONCENTRATORD_EVENT_URL"),
		os.Getenv("CONCENTRATORD_COMMAND_URL"),
	)
}

// Enabled returns true if both event and command URLs are set.
func (c *Client) Enabled() bool {
	return c.eventURL != "" && c.commandURL != ""
}

// Run implements gateway.UplinkSource. It subscribes to "up" events and calls onUplink for each.
// If the concentratord socket is not available (e.g. concentratord not running), it retries dial
// every dialRetryEvery until context is cancelled.
func (c *Client) Run(ctx context.Context, onUplink func(*gw.UplinkFrame)) error {
	if !c.Enabled() {
		return fmt.Errorf("concentratord: event or command URL not set")
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		sub := zmq4.NewSub(ctx)
		if err := sub.Dial(c.eventURL); err != nil {
			log.Printf("concentratord SUB dial: %v (retry in %v)", err, dialRetryEvery)
			_ = sub.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(dialRetryEvery):
			}
			continue
		}
		if err := sub.SetOption(zmq4.OptionSubscribe, eventTypeUp); err != nil {
			log.Printf("concentratord SUB subscribe: %v", err)
			_ = sub.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(dialRetryEvery):
			}
			continue
		}
		log.Printf("concentratord SUB connected to %s", c.eventURL)
		for {
			msg, err := sub.Recv()
			if err != nil {
				if ctx.Err() != nil {
					_ = sub.Close()
					return ctx.Err()
				}
				log.Printf("concentratord SUB recv: %v (reconnecting)", err)
				_ = sub.Close()
				break
			}
			if frame := parseUplinkEvent(msg); frame != nil {
				onUplink(frame)
			}
		}
	}
}

const (
	commandTypeConfig   = "config"
	commandTypeGatewayID = "gateway_id"
)

// GetGatewayID returns the concentratord gateway ID (8 bytes as hex string). Used to push config when CONCENTRATORD_GATEWAY_ID is unset.
func (c *Client) GetGatewayID(ctx context.Context) (string, error) {
	if err := c.ensureCommandConn(ctx); err != nil {
		return "", err
	}
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	// Concentratord API: frame 0 = "gateway_id", frame 1 = empty; response = 8-byte ID.
	if err := c.req.Send(zmq4.NewMsgFrom([]byte(commandTypeGatewayID), []byte{})); err != nil {
		return "", fmt.Errorf("concentratord REQ send gateway_id: %w", err)
	}
	rep, err := c.req.Recv()
	if err != nil {
		return "", fmt.Errorf("concentratord REQ recv gateway_id: %w", err)
	}
	if len(rep.Frames) == 0 || len(rep.Frames[0]) != 8 {
		return "", fmt.Errorf("concentratord gateway_id: invalid response (want 8 bytes)")
	}
	id := rep.Frames[0]
	return fmt.Sprintf("%02x%02x%02x%02x%02x%02x%02x%02x", id[0], id[1], id[2], id[3], id[4], id[5], id[6], id[7]), nil
}

// ensureCommandConn ensures the REQ socket is connected (shared by SendConfig and SendDownlink).
func (c *Client) ensureCommandConn(ctx context.Context) error {
	if !c.Enabled() {
		return fmt.Errorf("concentratord: not configured")
	}
	c.reqOnce.Do(func() {
		c.req = zmq4.NewReq(ctx)
		if err := c.req.Dial(c.commandURL); err != nil {
			c.reqErr = fmt.Errorf("concentratord REQ dial: %w", err)
			return
		}
		log.Printf("concentratord REQ connected to %s", c.commandURL)
	})
	return c.reqErr
}

// SendConfig sends the "config" command (frame0="config", frame1=GatewayConfiguration).
// Channel configuration is normally file-based; this is for optional push. Not called from pipeline.
func (c *Client) SendConfig(ctx context.Context, cfg *gw.GatewayConfiguration) error {
	if err := c.ensureCommandConn(ctx); err != nil {
		return err
	}
	body, err := proto.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal GatewayConfiguration: %w", err)
	}
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	if err := c.req.Send(zmq4.NewMsgFrom([]byte(commandTypeConfig), body)); err != nil {
		return fmt.Errorf("concentratord REQ send config: %w", err)
	}
	_, err = c.req.Recv()
	if err != nil {
		return fmt.Errorf("concentratord REQ recv config: %w", err)
	}
	return nil
}

// SendDownlink implements gateway.DownlinkSender. Sends frame0="down", frame1=DownlinkFrame (Protobuf); response is DownlinkTxAck.
func (c *Client) SendDownlink(ctx context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error) {
	if err := c.ensureCommandConn(ctx); err != nil {
		return nil, err
	}
	body, err := proto.Marshal(frame)
	if err != nil {
		return nil, fmt.Errorf("marshal DownlinkFrame: %w", err)
	}
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	if err := c.req.Send(zmq4.NewMsgFrom([]byte("down"), body)); err != nil {
		return nil, fmt.Errorf("concentratord REQ send: %w", err)
	}
	rep, err := c.req.Recv()
	if err != nil {
		return nil, fmt.Errorf("concentratord REQ recv: %w", err)
	}
	if len(rep.Frames) == 0 {
		return nil, fmt.Errorf("concentratord ack: empty response")
	}
	var ack gw.DownlinkTxAck
	if err := proto.Unmarshal(rep.Frames[0], &ack); err != nil {
		return nil, fmt.Errorf("concentratord ack unmarshal: %w", err)
	}
	return &ack, nil
}

// Ensure Client implements the interfaces at compile time.
var (
	_ gateway.UplinkSource   = (*Client)(nil)
	_ gateway.DownlinkSender = (*Client)(nil)
)
