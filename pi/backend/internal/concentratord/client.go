package concentratord

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/chirpstack/chirpstack/api/go/v4/gw"
	"github.com/go-zeromq/zmq4"
	"google.golang.org/protobuf/proto"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

const eventTypeUp = "up"

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
func (c *Client) Run(ctx context.Context, onUplink func(*gw.UplinkFrame)) error {
	if !c.Enabled() {
		return fmt.Errorf("concentratord: event or command URL not set")
	}
	c.subOnce.Do(func() {
		c.sub = zmq4.NewSub(ctx)
		if err := c.sub.Dial(c.eventURL); err != nil {
			c.subErr = fmt.Errorf("concentratord SUB dial: %w", err)
			return
		}
		if err := c.sub.SetOption(zmq4.OptionSubscribe, eventTypeUp); err != nil {
			c.subErr = fmt.Errorf("concentratord SUB subscribe: %w", err)
			_ = c.sub.Close()
			return
		}
	})
	if c.subErr != nil {
		return c.subErr
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		msg, err := c.sub.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Printf("concentratord SUB recv: %v", err)
			continue
		}
		if len(msg.Frames) < 2 {
			continue
		}
		eventType := string(msg.Frames[0])
		if eventType != eventTypeUp {
			continue
		}
		body := msg.Frames[1]
		var ev gw.UplinkFrame
		if err := proto.Unmarshal(body, &ev); err != nil {
			log.Printf("concentratord uplink unmarshal: %v", err)
			continue
		}
		onUplink(&ev)
	}
}

// SendDownlink implements gateway.DownlinkSender. Sends "down" command with the frame and returns the ack.
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
	})
	if c.reqErr != nil {
		return nil, c.reqErr
	}
	body, err := proto.Marshal(frame)
	if err != nil {
		return nil, fmt.Errorf("marshal DownlinkFrame: %w", err)
	}
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	reqMsg := zmq4.NewMsgFrom([]byte("down"), body)
	if err := c.req.SendMulti(reqMsg); err != nil {
		return nil, fmt.Errorf("concentratord REQ send: %w", err)
	}
	rep, err := c.req.Recv()
	if err != nil {
		return nil, fmt.Errorf("concentratord REQ recv: %w", err)
	}
	// Response is DownlinkTxAck (single frame or first frame)
	var ackData []byte
	if len(rep.Frames) > 0 {
		ackData = rep.Frames[0]
	}
	var ack gw.DownlinkTxAck
	if err := proto.Unmarshal(ackData, &ack); err != nil {
		return nil, fmt.Errorf("concentratord ack unmarshal: %w", err)
	}
	return &ack, nil
}

// Ensure Client implements the interfaces at compile time.
var (
	_ gateway.UplinkSource   = (*Client)(nil)
	_ gateway.DownlinkSender = (*Client)(nil)
)
