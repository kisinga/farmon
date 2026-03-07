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

// SendDownlink implements gateway.DownlinkSender. Sends gw.Command (single frame) and returns the ack.
// Concentratord expects one frame: serialized gw.Command with SendDownlinkFrame set.
func (c *Client) SendDownlink(ctx context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("concentratord: not configured")
	}
	c.reqOnce.Do(func() {
		c.req = zmq4.NewReq(ctx)
		if err := c.req.Dial(c.commandURL); err != nil {
			c.reqErr = fmt.Errorf("concentratord REQ dial: %w", err)
			return
		}
		log.Printf("concentratord REQ connected to %s", c.commandURL)
	})
	if c.reqErr != nil {
		return nil, c.reqErr
	}
	cmd := &gw.Command{
		Command: &gw.Command_SendDownlinkFrame{SendDownlinkFrame: frame},
	}
	body, err := proto.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("marshal Command: %w", err)
	}
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	if err := c.req.Send(zmq4.NewMsgFrom(body)); err != nil {
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
