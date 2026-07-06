// Package alerts sends away-coverage notifications. Everything the user sees
// in-app is derived in the browser from realtime data; this is the one piece
// that cannot move there, because a browser does not run while its tab is shut.
//
// The sweep re-derives the same conditions the frontend does from data the
// server already stores (controller presence, tank-level shadows, fault
// transitions), then sends WhatsApp via OpenWA or email when owners opt in. It
// owns no state beyond an in-memory per-incident cooldown, so it needs no alerts
// table.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
)

const (
	sweepInterval     = 60 * time.Second
	defaultLowPct     = 20.0
	defaultOfflineSec = 180.0
	// Kenya is the default country context for local WhatsApp numbers.
	defaultWhatsAppCountryCode = "254"
	// Floor for a positive offline_timeout_s: it must stay well above the telemetry
	// cadence (update_interval, capped at 60s) so a healthy device's normal gap
	// between samples can never read as offline. 0 still means "use the default".
	offlineFloorSec = 120.0
	// Re-notify window: one external notification per incident at most this often,
	// so a stuck condition doesn't spam the owner every tick.
	cooldown = 30 * time.Minute
	// A fault transition older than this is treated as history, not a live alert.
	faultRecent = 30 * time.Minute
)

// RunSweeper runs the external-alert loop until the process exits. Safe to start
// even when SMTP/OpenWA are unconfigured: channel prefs default silent, and each
// sender reports a retryable error when its infrastructure is missing.
func RunSweeper(app core.App) {
	s := &sweeper{lastSent: map[string]time.Time{}, openwa: openWAFromEnv(http.DefaultClient)}
	t := time.NewTicker(sweepInterval)
	defer t.Stop()
	for now := range t.C {
		if err := s.run(app, now); err != nil {
			log.Printf("alerts: sweep: %v", err)
		}
	}
}

type sweeper struct {
	mu       sync.Mutex
	lastSent map[string]time.Time
	openwa   openWAClient
}

// shouldSend reports whether a key is outside its cooldown. It does NOT stamp:
// the send time is recorded only after a successful channel send, so a failed
// delivery retries on the next tick instead of going dark for a cooldown.
func (s *sweeper) shouldSend(key string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	last, ok := s.lastSent[key]
	return !ok || now.Sub(last) >= cooldown
}

func (s *sweeper) markSent(key string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastSent[key] = now
}

// notify sends one alert to the requested external channels if the key is off
// cooldown, stamping the cooldown only when at least one channel succeeds.
func (s *sweeper) notify(app core.App, to recipients, now time.Time, key, subject, body string) {
	if !to.any() || !s.shouldSend(key, now) {
		return
	}
	delivered := false
	if len(to.whatsapp) > 0 {
		if err := s.sendWhatsApp(to.whatsapp, subject, body); err != nil {
			log.Printf("alerts: whatsapp to %v: %v", to.whatsapp, err)
		} else {
			delivered = true
		}
	}
	if len(to.email) > 0 {
		if err := s.sendEmail(app, to.email, subject, body); err != nil {
			log.Printf("alerts: email to %v: %v", to.email, err)
		} else {
			delivered = true
		}
	}
	if delivered {
		s.markSent(key, now)
	}
}

// siteCtx carries a site's thresholds plus the per-alert recipient lists. A site
// has equal co-owners, each with their own notification prefs, so the same
// incident reaches exactly those who asked for it.
type siteCtx struct {
	id        string
	name      string
	lowPct    float64
	highPct   float64 // 0 == no high alert
	offlineMs float64
	offlineTo recipients
	faultTo   recipients
	tankTo    recipients
}

type prefs struct {
	offline, fault, tank, email, whatsapp bool
	chatID                                string
}

type recipients struct {
	email    []string
	whatsapp []string
}

func (r recipients) any() bool {
	return len(r.email) > 0 || len(r.whatsapp) > 0
}

func (r *recipients) addEmail(email string) {
	if email != "" {
		r.email = append(r.email, email)
	}
}

func (r *recipients) addWhatsApp(chatID string) {
	if chatID != "" {
		r.whatsapp = append(r.whatsapp, chatID)
	}
}

func (s *sweeper) run(app core.App, now time.Time) error {
	sites, err := app.FindAllRecords("sites")
	if err != nil {
		return err
	}
	for _, site := range sites {
		sc, ok := resolveSite(app, site)
		if !ok {
			continue
		}
		s.sweepOffline(app, sc, now)
		s.sweepTanks(app, sc, now)
		s.sweepFaults(app, sc, now)
	}
	return nil
}

// resolveSite gathers a site's thresholds and per-alert recipients.
func resolveSite(app core.App, site *core.Record) (siteCtx, bool) {
	ownerIDs := site.GetStringSlice("owner")
	if len(ownerIDs) == 0 {
		return siteCtx{}, false
	}

	var offlineTo, faultTo, tankTo recipients
	for _, ownerID := range ownerIDs {
		owner, err := app.FindRecordById("users", ownerID)
		if err != nil {
			continue
		}
		p := resolvePrefs(app, ownerID)
		if p.offline {
			if p.whatsapp {
				offlineTo.addWhatsApp(p.chatID)
			}
			if p.email {
				offlineTo.addEmail(owner.GetString("email"))
			}
		}
		if p.fault {
			if p.whatsapp {
				faultTo.addWhatsApp(p.chatID)
			}
			if p.email {
				faultTo.addEmail(owner.GetString("email"))
			}
		}
		if p.tank {
			if p.whatsapp {
				tankTo.addWhatsApp(p.chatID)
			}
			if p.email {
				tankTo.addEmail(owner.GetString("email"))
			}
		}
	}
	if !offlineTo.any() && !faultTo.any() && !tankTo.any() {
		return siteCtx{}, false
	}

	low := site.GetFloat("tank_low_pct")
	if low <= 0 {
		low = defaultLowPct
	}
	offMs := site.GetFloat("offline_timeout_s")
	if offMs <= 0 {
		offMs = defaultOfflineSec
	} else if offMs < offlineFloorSec {
		offMs = offlineFloorSec
	}

	return siteCtx{
		id:        site.Id,
		name:      siteName(site),
		lowPct:    low,
		highPct:   site.GetFloat("tank_high_pct"), // 0 disables high alerts
		offlineMs: offMs * 1000,
		offlineTo: offlineTo,
		faultTo:   faultTo,
		tankTo:    tankTo,
	}, true
}

// resolvePrefs reads the owner's notification_prefs. No row means alert types
// default on except offline, while external channels default off.
func resolvePrefs(app core.App, userID string) prefs {
	rec, err := app.FindFirstRecordByFilter("notification_prefs", "user = {:u}", dbx.Params{"u": userID})
	if err != nil || rec == nil {
		return prefs{offline: false, fault: true, tank: true, email: false, whatsapp: false}
	}
	return prefs{
		offline:  rec.GetBool("alert_device_offline"),
		fault:    rec.GetBool("alert_fault"),
		tank:     rec.GetBool("alert_tank"),
		email:    rec.GetBool("channel_email"),
		whatsapp: rec.GetBool("channel_whatsapp"),
		chatID:   normalizeWhatsAppChatID(rec.GetString("whatsapp_chat_id"), rec.GetString("whatsapp_country_code")),
	}
}

func (s *sweeper) sweepOffline(app core.App, sc siteCtx, now time.Time) {
	if !sc.offlineTo.any() {
		return
	}
	ctrls, err := app.FindRecordsByFilter("controllers", "site = {:s} && active = true", "", 0, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	for _, c := range ctrls {
		seen := c.GetDateTime("last_seen").Time()
		// Staleness only. The `online` flag flips false on any brief broker drop,
		// so last_seen aging past the timeout is the naturally-debounced signal.
		stale := !seen.IsZero() && now.Sub(seen) > time.Duration(sc.offlineMs)*time.Millisecond
		if stale {
			s.notify(app, sc.offlineTo, now, "offline:"+c.Id, "Controller offline",
				fmt.Sprintf("%s on %s has gone offline (last seen %s).", c.Id, sc.name, lastSeenText(seen)))
		}
	}
}

func (s *sweeper) sweepTanks(app core.App, sc siteCtx, now time.Time) {
	if !sc.tankTo.any() {
		return
	}
	docs, err := app.FindRecordsByFilter("controller_state", "site = {:s}", "", 0, 0,
		dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	for _, d := range docs {
		var snap struct {
			Readings map[string]float64 `json:"readings"`
		}
		if json.Unmarshal([]byte(d.GetString("snapshot")), &snap) != nil {
			continue
		}
		for sensor, v := range snap.Readings {
			if !strings.HasSuffix(sensor, "_level") {
				continue
			}
			if v <= sc.lowPct {
				s.notify(app, sc.tankTo, now, "tanklow:"+sc.id+":"+sensor, "Tank low",
					fmt.Sprintf("%s on %s is at %.0f%% (low threshold %.0f%%).", tankName(sensor), sc.name, v, sc.lowPct))
			} else if sc.highPct > 0 && v >= sc.highPct {
				s.notify(app, sc.tankTo, now, "tankhigh:"+sc.id+":"+sensor, "Tank full",
					fmt.Sprintf("%s on %s is at %.0f%% (high threshold %.0f%%).", tankName(sensor), sc.name, v, sc.highPct))
			}
		}
	}
}

func (s *sweeper) sweepFaults(app core.App, sc siteCtx, now time.Time) {
	if !sc.faultTo.any() {
		return
	}
	rows, err := app.FindRecordsByFilter("state_events", "site = {:s}", "-ts", 200, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	seen := map[string]bool{}
	for _, e := range rows {
		rk := e.GetString("controller") + ":" + e.GetString("route")
		if seen[rk] {
			continue
		}
		seen[rk] = true
		if e.GetString("to_state") != "FAULT" {
			continue
		}
		ts := parseTS(e.GetString("ts"))
		if ts.IsZero() || now.Sub(ts) > faultRecent {
			continue
		}
		s.notify(app, sc.faultTo, now, "fault:"+sc.id+":"+rk, "Fault",
			fmt.Sprintf("%s on %s reported a fault: %s.", e.GetString("controller"), sc.name, reasonText(e.GetString("reason"))))
	}
}

func (s *sweeper) sendEmail(app core.App, to []string, subject, body string) error {
	if !app.Settings().SMTP.Enabled {
		return fmt.Errorf("SMTP is not configured")
	}
	addrs := make([]mail.Address, len(to))
	for i, a := range to {
		addrs[i] = mail.Address{Address: a}
	}
	msg := &mailer.Message{
		From:    mail.Address{Address: app.Settings().Meta.SenderAddress, Name: app.Settings().Meta.SenderName},
		To:      addrs,
		Subject: "MajiFlow alert: " + subject,
		HTML:    fmt.Sprintf("<p>%s</p><p style=\"color:#64748b;font-size:12px\">You're receiving this because email alerts are on for your account. Manage them on your account page.</p>", body),
		Text:    body,
	}
	return app.NewMailClient().Send(msg)
}

func (s *sweeper) sendWhatsApp(to []string, subject, body string) error {
	if !s.openwa.configured() {
		return fmt.Errorf("OpenWA is not configured")
	}
	text := fmt.Sprintf("MajiFlow alert: %s\n%s", subject, body)
	var errs []string
	for _, chatID := range to {
		if err := s.openwa.sendText(context.Background(), chatID, text); err != nil {
			errs = append(errs, chatID+": "+err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

type openWAClient struct {
	baseURL string
	apiKey  string
	session string
	client  *http.Client
}

func openWAFromEnv(client *http.Client) openWAClient {
	return openWAClient{
		baseURL: strings.TrimRight(os.Getenv("MAJI_OPENWA_BASE_URL"), "/"),
		apiKey:  os.Getenv("MAJI_OPENWA_API_KEY"),
		session: os.Getenv("MAJI_OPENWA_SESSION"),
		client:  client,
	}
}

func (c openWAClient) configured() bool {
	return c.baseURL != "" && c.apiKey != "" && c.session != "" && c.client != nil
}

func (c openWAClient) sendText(ctx context.Context, chatID, text string) error {
	if !c.configured() {
		return fmt.Errorf("OpenWA is not configured")
	}
	body, err := json.Marshal(map[string]string{"chatId": chatID, "text": text})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	url := fmt.Sprintf("%s/api/sessions/%s/messages/send-text", c.baseURL, c.session)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("OpenWA status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
}

func siteName(r *core.Record) string {
	if n := r.GetString("name"); n != "" {
		return n
	}
	if n := r.GetString("friendlyName"); n != "" {
		return n
	}
	return "your site"
}

func parseTS(s string) time.Time {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

func lastSeenText(t time.Time) string {
	if t.IsZero() {
		return "unknown"
	}
	return t.UTC().Format("2006-01-02 15:04 UTC")
}

func tankName(sensor string) string {
	base := strings.TrimSuffix(sensor, "_level")
	parts := strings.Split(base, "_")
	for i, p := range parts {
		if p != "" {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

var nonDigit = regexp.MustCompile(`\D+`)

func normalizeWhatsAppChatID(raw, countryCode string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "@") {
		return raw
	}
	digits := nonDigit.ReplaceAllString(raw, "")
	digits = strings.TrimPrefix(digits, "00")
	if digits == "" {
		return ""
	}
	country := nonDigit.ReplaceAllString(countryCode, "")
	if country == "" {
		country = defaultWhatsAppCountryCode
	}
	if strings.HasPrefix(digits, country) {
		return digits + "@c.us"
	}
	if strings.HasPrefix(digits, "0") {
		return country + strings.TrimLeft(digits, "0") + "@c.us"
	}
	// Short local form, e.g. 712345678 with KE +254 selected.
	if len(digits) <= 10 {
		return country + digits + "@c.us"
	}
	return digits + "@c.us"
}

// reasonText turns a fault/stop token into a readable phrase. Kept in step with
// the FAULT_MEANINGS/STOP_REASON_MEANINGS dictionaries in src/lib/codegen-ids.ts.
func reasonText(token string) string {
	switch token {
	case "":
		return "unknown cause"
	case "NO_FLOW":
		return "no flow detected"
	case "MAX_RUNTIME":
		return "max runtime exceeded"
	case "CONTROL_LOST":
		return "control link lost"
	case "SOURCE_LOW":
		return "source tank low"
	case "TANK_FULL":
		return "tank full"
	default:
		return strings.ToLower(strings.ReplaceAll(token, "_", " "))
	}
}
