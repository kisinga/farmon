// Package concentratord implements the ChirpStack Concentratord ZMQ API.
// Commands (REQ): frame0 = command string, frame1 = Protobuf payload.
// Events (SUB): frame0 = event type ("up" | "stats"), frame1 = Protobuf payload.
// See https://www.chirpstack.io/docs/chirpstack-concentratord/api/commands.html and docs/concentratord-api.md.
package concentratord

import (
	"context"
	"fmt"
	"log"
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
	eventTypeStats    = "stats"
	dialRetryEvery    = 5 * time.Second
	unmarshalLogEvery = 5 * time.Minute
)

var (
	lastUnmarshalLog   time.Time
	unmarshalLogMu     sync.Mutex
)

// topicString normalizes the first ZMQ frame (event type) for comparison; trim trailing nulls and whitespace so we match "up"/"stats" even if concentratord sends "up\x00" or "up ".
func topicString(frame []byte) string {
	return strings.TrimSpace(strings.TrimRight(string(frame), "\x00"))
}

// parseUplinkEvent returns the UplinkFrame from a ZMQ message (topic+body or body only).
// Supports both gw.Event (concentratord) and raw gw.UplinkFrame (e.g. gateway bridge).
func parseUplinkEvent(msg zmq4.Msg) *gw.UplinkFrame {
	frames := msg.Frames
	if len(frames) == 0 {
		return nil
	}
	payload := frames[0]
	if len(frames) >= 2 && topicString(frames[0]) == eventTypeUp {
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
		topic := ""
		if len(frames) >= 1 {
			topic = topicString(frames[0])
		}
		log.Printf("concentratord event: topic=%q payload_len=%d — payload is neither Event nor UplinkFrame", topic, len(payload))
	}
	return nil
}

// parseStatsEvent returns the GatewayStats from a ZMQ message (topic "stats", frame1 = Protobuf).
// Supports Event{ event: GatewayStats } or raw gw.GatewayStats.
func parseStatsEvent(msg zmq4.Msg) *gw.GatewayStats {
	frames := msg.Frames
	if len(frames) < 2 || topicString(frames[0]) != eventTypeStats {
		return nil
	}
	payload := frames[1]
	var stats gw.GatewayStats
	if err := proto.Unmarshal(payload, &stats); err == nil {
		return &stats
	}
	var ev gw.Event
	if err := proto.Unmarshal(payload, &ev); err == nil {
		if gs := ev.GetGatewayStats(); gs != nil {
			return gs
		}
	}
	return nil
}

// Client implements gateway.UplinkSource and gateway.DownlinkSender using
// Concentratord ZMQ (SUB for events, REQ for commands).
// Concentratord can be restarted; the REQ socket is recreated on connection errors (see isConnError).
type Client struct {
	eventURL   string
	commandURL string
	sub        zmq4.Socket
	req        zmq4.Socket
	reqReady   bool   // true when req is connected and usable
	reqErr     error  // last dial error when reqReady is false
	reqMu      sync.Mutex
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

// Enabled returns true if both event and command URLs are set.
func (c *Client) Enabled() bool {
	return c.eventURL != "" && c.commandURL != ""
}

// Run implements gateway.UplinkSource. It subscribes to "up" and "stats" events.
// onUplink is called for each uplink; onStats is called for each stats event (may be nil).
// If the concentratord socket is not available (e.g. concentratord not running), it retries dial
// every dialRetryEvery until context is cancelled.
func (c *Client) Run(ctx context.Context, onUplink func(*gw.UplinkFrame), onStats func(*gw.GatewayStats)) error {
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
			log.Printf("concentratord SUB subscribe up: %v", err)
			_ = sub.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(dialRetryEvery):
			}
			continue
		}
		if err := sub.SetOption(zmq4.OptionSubscribe, eventTypeStats); err != nil {
			log.Printf("concentratord SUB subscribe stats: %v", err)
			_ = sub.Close()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(dialRetryEvery):
			}
			continue
		}
		eventURL := c.eventURL
		if len(eventURL) > 60 {
			eventURL = eventURL[:57] + "..."
		}
		log.Printf("concentratord SUB connected to %s", eventURL)
		uplinkCount := 0
		for {
			msg, err := sub.Recv()
			if err != nil {
				if ctx.Err() != nil {
					_ = sub.Close()
					return ctx.Err()
				}
				log.Printf("concentratord SUB recv: %v (reconnecting)", err)
				_ = sub.Close()
				c.closeReq() // align REQ lifecycle: next command will use a fresh socket
				break
			}
			if len(msg.Frames) >= 1 {
				topic := topicString(msg.Frames[0])
				if topic == eventTypeUp {
					if frame := parseUplinkEvent(msg); frame != nil {
						uplinkCount++
						if uplinkCount%50 == 0 {
							log.Printf("concentratord: received %d uplinks so far", uplinkCount)
						}
						onUplink(frame)
					}
				} else if topic == eventTypeStats && onStats != nil {
					if stats := parseStatsEvent(msg); stats != nil {
						onStats(stats)
					}
				}
			}
		}
	}
}

const (
	commandTypeConfig    = "config"
	commandTypeGatewayID = "gateway_id"
)

// isConnError reports whether err indicates the REQ connection is dead (reconnect and retry).
func isConnError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "connection closed") ||
		strings.Contains(s, "no connections available") ||
		strings.Contains(s, "read/write on closed")
}

// closeReq closes the REQ socket so the next ensureCommandConn will reconnect.
func (c *Client) closeReq() {
	c.reqMu.Lock()
	defer c.reqMu.Unlock()
	if c.reqReady {
		_ = c.req.Close()
		c.reqReady = false
	}
}

// ensureCommandConn ensures the REQ socket is connected (shared by GetGatewayID, SendConfig, SendDownlink).
func (c *Client) ensureCommandConn(ctx context.Context) error {
	if !c.Enabled() {
		return fmt.Errorf("concentratord: not configured")
	}
	c.reqMu.Lock()
	if c.reqReady {
		c.reqMu.Unlock()
		return nil
	}
	c.req = zmq4.NewReq(ctx)
	if err := c.req.Dial(c.commandURL); err != nil {
		c.reqErr = fmt.Errorf("concentratord REQ dial: %w", err)
		c.reqMu.Unlock()
		return c.reqErr
	}
	c.reqReady = true
	c.reqErr = nil
	log.Printf("concentratord REQ connected to %s", c.commandURL)
	c.reqMu.Unlock()
	return nil
}

// GetGatewayID returns the concentratord gateway ID (8 bytes as hex string). Used when gateway_id is not set in gateway settings.
func (c *Client) GetGatewayID(ctx context.Context) (string, error) {
	id, err := c.getGatewayIDOnce(ctx)
	if err != nil && isConnError(err) {
		c.closeReq()
		id, err = c.getGatewayIDOnce(ctx)
	}
	return id, err
}

func (c *Client) getGatewayIDOnce(ctx context.Context) (string, error) {
	if err := c.ensureCommandConn(ctx); err != nil {
		return "", err
	}
	c.reqMu.Lock()
	err := c.req.Send(zmq4.NewMsgFrom([]byte(commandTypeGatewayID), []byte{}))
	if err != nil {
		c.reqMu.Unlock()
		return "", err
	}
	rep, err := c.req.Recv()
	c.reqMu.Unlock()
	if err != nil {
		return "", err
	}
	if len(rep.Frames) == 0 || len(rep.Frames[0]) != 8 {
		return "", fmt.Errorf("concentratord gateway_id: invalid response (want 8 bytes)")
	}
	id := rep.Frames[0]
	return fmt.Sprintf("%02x%02x%02x%02x%02x%02x%02x%02x", id[0], id[1], id[2], id[3], id[4], id[5], id[6], id[7]), nil
}

// SendConfig sends the "config" command (frame0="config", frame1=GatewayConfiguration).
// Channel configuration is normally file-based; this is for optional in-memory push.
func (c *Client) SendConfig(ctx context.Context, cfg *gw.GatewayConfiguration) error {
	err := c.sendConfigOnce(ctx, cfg)
	if err != nil && isConnError(err) {
		c.closeReq()
		err = c.sendConfigOnce(ctx, cfg)
	}
	return err
}

func (c *Client) sendConfigOnce(ctx context.Context, cfg *gw.GatewayConfiguration) error {
	if err := c.ensureCommandConn(ctx); err != nil {
		return err
	}
	body, err := proto.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal GatewayConfiguration: %w", err)
	}
	c.reqMu.Lock()
	err = c.req.Send(zmq4.NewMsgFrom([]byte(commandTypeConfig), body))
	if err != nil {
		c.reqMu.Unlock()
		return fmt.Errorf("concentratord REQ send config: %w", err)
	}
	_, err = c.req.Recv()
	c.reqMu.Unlock()
	if err != nil {
		return fmt.Errorf("concentratord REQ recv config: %w", err)
	}
	return nil
}

// SendDownlink implements gateway.DownlinkSender. Sends a single frame with gw.Command{ SendDownlinkFrame }
// so concentratord (which decodes one frame as Command) receives the frame and uses TxInfo.Frequency for TX.
// Response is DownlinkTxAck.
func (c *Client) SendDownlink(ctx context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error) {
	ack, err := c.sendDownlinkOnce(ctx, frame)
	if err != nil && isConnError(err) {
		c.closeReq()
		ack, err = c.sendDownlinkOnce(ctx, frame)
	}
	return ack, err
}

func (c *Client) sendDownlinkOnce(ctx context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error) {
	if err := c.ensureCommandConn(ctx); err != nil {
		return nil, err
	}
	cmd := &gw.Command{
		Command: &gw.Command_SendDownlinkFrame{SendDownlinkFrame: frame},
	}
	body, err := proto.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("marshal Command: %w", err)
	}
	c.reqMu.Lock()
	err = c.req.Send(zmq4.NewMsgFrom(body))
	if err != nil {
		c.reqMu.Unlock()
		return nil, fmt.Errorf("concentratord REQ send: %w", err)
	}
	rep, err := c.req.Recv()
	c.reqMu.Unlock()
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
