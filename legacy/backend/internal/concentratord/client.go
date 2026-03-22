// Package concentratord implements the ChirpStack Concentratord ZMQ API.
// Commands (REQ): frame0 = command string, frame1 = Protobuf payload.
// Events (SUB): frame0 = event type ("up" | "stats"), frame1 = Protobuf payload.
// See https://www.chirpstack.io/docs/chirpstack-concentratord/api/commands.html
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

	"github.com/kisinga/farmon/internal/gateway"
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

// topicString normalizes the first ZMQ frame (event type); trims trailing nulls/whitespace so we
// match "up"/"stats" even if concentratord sends "up\x00" or "up ".
func topicString(frame []byte) string {
	return strings.TrimSpace(strings.TrimRight(string(frame), "\x00"))
}

// parseUplinkEvent returns the UplinkFrame from a ZMQ message.
// Supports both gw.Event (concentratord) and raw gw.UplinkFrame (gateway bridge).
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
	// Fallback: raw UplinkFrame.
	var uf gw.UplinkFrame
	if err := proto.Unmarshal(payload, &uf); err == nil && len(uf.GetPhyPayload()) > 0 {
		return &uf
	}
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

// parseStatsEvent returns the GatewayStats from a ZMQ message.
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
// Each command opens a fresh REQ socket, sends one request, reads one reply, then closes.
// This avoids all socket state bugs: context lifetime issues, stuck-send-state, reconnect races.
type Client struct {
	eventURL   string
	commandURL string
}

// NewClient creates a client. eventURL and commandURL are ZMQ endpoints
// (e.g. "ipc:///tmp/concentratord_event").
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

// Run implements gateway.UplinkSource. Subscribes to "up" and "stats" topics.
// Retries dial every dialRetryEvery on failure. Blocks until ctx is done.
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

// commandTimeout is the per-command deadline. Concentratord should ack within a few ms;
// 10s gives ample room for a slow system while preventing goroutine leaks if concentratord
// crashes between receiving the REQ and sending the REP.
const commandTimeout = 10 * time.Second

// doCommand opens a fresh REQ socket, sends one command, reads one reply, then closes the socket.
// Each call is independent: no shared state, no stuck-send-state, no reconnect races.
func (c *Client) doCommand(command string, body []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	req := zmq4.NewReq(ctx)
	defer req.Close()
	if err := req.Dial(c.commandURL); err != nil {
		return nil, fmt.Errorf("concentratord REQ dial %s: %w", c.commandURL, err)
	}
	if err := req.Send(zmq4.NewMsgFrom([]byte(command), body)); err != nil {
		return nil, fmt.Errorf("concentratord REQ send %q: %w", command, err)
	}
	rep, err := req.Recv()
	if err != nil {
		return nil, fmt.Errorf("concentratord REQ recv %q: %w", command, err)
	}
	if len(rep.Frames) == 0 {
		return nil, fmt.Errorf("concentratord %q: empty response", command)
	}
	return rep.Frames[0], nil
}

// GetGatewayID returns the concentratord gateway ID (8 bytes as hex string).
func (c *Client) GetGatewayID(_ context.Context) (string, error) {
	resp, err := c.doCommand("gateway_id", []byte{})
	if err != nil {
		return "", err
	}
	if len(resp) != 8 {
		return "", fmt.Errorf("concentratord gateway_id: invalid response (want 8 bytes, got %d)", len(resp))
	}
	return fmt.Sprintf("%02x%02x%02x%02x%02x%02x%02x%02x",
		resp[0], resp[1], resp[2], resp[3], resp[4], resp[5], resp[6], resp[7]), nil
}

// SendConfig sends the "config" command with a GatewayConfiguration payload.
func (c *Client) SendConfig(_ context.Context, cfg *gw.GatewayConfiguration) error {
	body, err := proto.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal GatewayConfiguration: %w", err)
	}
	_, err = c.doCommand("config", body)
	return err
}

// SendDownlink implements gateway.DownlinkSender. Sends frame0="down", frame1=DownlinkFrame;
// response is DownlinkTxAck.
func (c *Client) SendDownlink(_ context.Context, frame *gw.DownlinkFrame) (*gw.DownlinkTxAck, error) {
	body, err := proto.Marshal(frame)
	if err != nil {
		return nil, fmt.Errorf("marshal DownlinkFrame: %w", err)
	}
	resp, err := c.doCommand("down", body)
	if err != nil {
		return nil, err
	}
	var ack gw.DownlinkTxAck
	if err := proto.Unmarshal(resp, &ack); err != nil {
		return nil, fmt.Errorf("concentratord ack unmarshal: %w", err)
	}
	return &ack, nil
}

// Ensure Client implements the interfaces at compile time.
var (
	_ gateway.UplinkSource   = (*Client)(nil)
	_ gateway.DownlinkSender = (*Client)(nil)
)
