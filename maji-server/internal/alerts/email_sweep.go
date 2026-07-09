// Package alerts sends away-coverage notifications. Everything the user sees
// in-app is derived in the browser from realtime data; this is the one piece
// that cannot move there, because a browser does not run while its tab is shut.
//
// The sweep re-derives the same conditions the frontend does from data the
// server already stores (controller presence, tank-level shadows, fault
// transitions), then sends WhatsApp via OpenWA or email when owners opt in. It
// persists only a tiny incident ledger: enough to send one external notification
// per active episode and then re-arm when the condition clears.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"regexp"
	"strings"
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
	// A fault transition older than this is treated as history, not a live alert.
	faultRecent = 30 * time.Minute
)

var ErrInvalidWhatsAppRecipient = errors.New("valid WhatsApp number is required")

// RunSweeper runs the external-alert loop until the process exits. Safe to start
// even when SMTP/OpenWA are unconfigured: channel prefs default silent, and each
// sender reports a retryable error when its infrastructure is missing.
func RunSweeper(app core.App) {
	s := &sweeper{openwa: openWAFromEnv(http.DefaultClient)}
	t := time.NewTicker(sweepInterval)
	defer t.Stop()
	for now := range t.C {
		if err := s.run(app, now); err != nil {
			log.Printf("alerts: sweep: %v", err)
		}
	}
}

type sweeper struct {
	openwa whatsAppSender
}

type whatsAppSender interface {
	configured() bool
	sendText(ctx context.Context, chatID, text string) error
}

// notify activates one incident and sends it once per active episode. A failed
// delivery leaves last_sent empty, so the next sweep retries; a resolved incident
// clears last_sent when it becomes active again.
func (s *sweeper) notify(app core.App, to recipients, now time.Time, siteID, key, kind, subject, body string) {
	incident, err := activateIncident(app, siteID, key, kind, subject, body, now)
	if err != nil {
		log.Printf("alerts: incident %s: %v", key, err)
		return
	}
	if !to.any() || incident.GetString("last_sent") != "" {
		return
	}
	delivered := false
	if len(to.whatsapp) > 0 {
		if err := s.sendWhatsApp(to.whatsapp, kind, subject, body); err != nil {
			log.Printf("alerts: whatsapp to %v: %v", to.whatsapp, err)
		} else {
			delivered = true
		}
	}
	if len(to.email) > 0 {
		if err := s.sendEmail(app, to.email, kind, subject, body); err != nil {
			log.Printf("alerts: email to %v: %v", to.email, err)
		} else {
			delivered = true
		}
	}
	if delivered {
		incident.Set("last_sent", iso(now))
		if err := app.Save(incident); err != nil {
			log.Printf("alerts: mark sent %s: %v", key, err)
		}
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
	runStartTo recipients
	runStopTo  recipients
}

type prefs struct {
	offline, fault, tank, runStart, runStop, email, whatsapp bool
	chatID                                                   string
}

type recipients struct {
	email    []string
	whatsapp []string
}

func (r recipients) any() bool {
	return len(r.email) > 0 || len(r.whatsapp) > 0
}

func (r *recipients) addEmail(email string) {
	email = strings.TrimSpace(email)
	if email != "" {
		for _, existing := range r.email {
			if strings.EqualFold(existing, email) {
				return
			}
		}
		r.email = append(r.email, email)
	}
}

func (r *recipients) addWhatsApp(chatID string) {
	chatID = strings.TrimSpace(chatID)
	if chatID != "" {
		for _, existing := range r.whatsapp {
			if existing == chatID {
				return
			}
		}
		r.whatsapp = append(r.whatsapp, chatID)
	}
}

// effectiveWhatsAppChatID returns the stored WhatsApp chat id if present,
// otherwise falls back to the user's profile phone number normalised for the
// default country context.
func effectiveWhatsAppChatID(p prefs, phone string) string {
	if p.chatID != "" {
		return p.chatID
	}
	return normalizeWhatsAppChatID(phone, defaultWhatsAppCountryCode)
}

func activateIncident(app core.App, siteID, key, kind, subject, body string, now time.Time) (*core.Record, error) {
	coll, err := app.FindCollectionByNameOrId("notification_incidents")
	if err != nil {
		return nil, err
	}
	rec, _ := app.FindFirstRecordByFilter("notification_incidents", "incident_key = {:k}", dbx.Params{"k": key})
	if rec == nil {
		rec = core.NewRecord(coll)
		rec.Set("site", siteID)
		rec.Set("incident_key", key)
		rec.Set("kind", kind)
		rec.Set("first_seen", iso(now))
	} else if rec.GetString("status") != "active" {
		rec.Set("first_seen", iso(now))
		rec.Set("last_sent", "")
	}
	rec.Set("site", siteID)
	rec.Set("kind", kind)
	rec.Set("status", "active")
	rec.Set("subject", subject)
	rec.Set("body", body)
	rec.Set("last_seen", iso(now))
	rec.Set("resolved_at", "")
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func resolveInactiveIncidents(app core.App, siteID string, active map[string]bool, now time.Time) {
	// Transition incidents are discrete event receipts (keyed by timestamp), not
	// ongoing conditions, so they are never auto-resolved here.
	rows, err := app.FindRecordsByFilter("notification_incidents",
		"site = {:s} && status = 'active' && kind != 'run_start' && kind != 'run_stop'", "", 0, 0, dbx.Params{"s": siteID})
	if err != nil {
		return
	}
	for _, rec := range rows {
		if active[rec.GetString("incident_key")] {
			continue
		}
		rec.Set("status", "resolved")
		rec.Set("resolved_at", iso(now))
		if err := app.Save(rec); err != nil {
			log.Printf("alerts: resolve %s: %v", rec.GetString("incident_key"), err)
		}
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
		active := map[string]bool{}
		s.sweepOffline(app, sc, now, active)
		s.sweepTanks(app, sc, now, active)
		s.sweepFaults(app, sc, now, active)
		resolveInactiveIncidents(app, sc.id, active, now)
		// Transitions are discrete events, not ongoing conditions; they are
		// notified separately and do not participate in the active-condition map.
		s.sweepTransitions(app, sc, now)
	}
	return nil
}

// resolveSite gathers a site's thresholds and per-alert recipients.
func resolveSite(app core.App, site *core.Record) (siteCtx, bool) {
	ownerIDs := site.GetStringSlice("owner")
	if len(ownerIDs) == 0 {
		return siteCtx{}, false
	}

	var offlineTo, faultTo, tankTo, runStartTo, runStopTo recipients
	for _, ownerID := range ownerIDs {
		owner, err := app.FindRecordById("users", ownerID)
		if err != nil {
			continue
		}
		p := resolvePrefs(app, ownerID)
		chatID := effectiveWhatsAppChatID(p, owner.GetString("phone"))
		if p.offline {
			if p.whatsapp {
				offlineTo.addWhatsApp(chatID)
			}
			if p.email {
				offlineTo.addEmail(owner.GetString("email"))
			}
		}
		if p.fault {
			if p.whatsapp {
				faultTo.addWhatsApp(chatID)
			}
			if p.email {
				faultTo.addEmail(owner.GetString("email"))
			}
		}
		if p.tank {
			if p.whatsapp {
				tankTo.addWhatsApp(chatID)
			}
			if p.email {
				tankTo.addEmail(owner.GetString("email"))
			}
		}
		if p.runStart {
			if p.whatsapp {
				runStartTo.addWhatsApp(chatID)
			}
			if p.email {
				runStartTo.addEmail(owner.GetString("email"))
			}
		}
		if p.runStop {
			if p.whatsapp {
				runStopTo.addWhatsApp(chatID)
			}
			if p.email {
				runStopTo.addEmail(owner.GetString("email"))
			}
		}
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
		id:         site.Id,
		name:       siteName(site),
		lowPct:     low,
		highPct:    site.GetFloat("tank_high_pct"), // 0 disables high alerts
		offlineMs:  offMs * 1000,
		offlineTo:  offlineTo,
		faultTo:    faultTo,
		tankTo:     tankTo,
		runStartTo: runStartTo,
		runStopTo:  runStopTo,
	}, true
}

// resolvePrefs reads the owner's notification_prefs. No row means alert types
// default on except offline, transitions, and email; WhatsApp defaults on and
// falls back to the user's profile phone if no dedicated chat id is stored.
func resolvePrefs(app core.App, userID string) prefs {
	rec, err := app.FindFirstRecordByFilter("notification_prefs", "user = {:u}", dbx.Params{"u": userID})
	if err != nil || rec == nil {
		return prefs{offline: false, fault: true, tank: true, email: false, whatsapp: true}
	}
	return prefs{
		offline:  rec.GetBool("alert_device_offline"),
		fault:    rec.GetBool("alert_fault"),
		tank:     rec.GetBool("alert_tank"),
		runStart: rec.GetBool("alert_run_start"),
		runStop:  rec.GetBool("alert_run_stop"),
		email:    rec.GetBool("channel_email"),
		whatsapp: rec.GetBool("channel_whatsapp"),
		chatID:   normalizeWhatsAppChatID(rec.GetString("whatsapp_chat_id"), rec.GetString("whatsapp_country_code")),
	}
}

func (s *sweeper) sweepOffline(app core.App, sc siteCtx, now time.Time, active map[string]bool) {
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
			key := "device_offline:" + sc.id + ":" + c.Id
			active[key] = true
			s.notify(app, sc.offlineTo, now, sc.id, key, "device_offline", "Controller offline",
				fmt.Sprintf("%s on %s has gone offline (last seen %s).", c.Id, sc.name, lastSeenText(seen)))
		}
	}
}

func (s *sweeper) sweepTanks(app core.App, sc siteCtx, now time.Time, active map[string]bool) {
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
				key := "tank_low:" + sc.id + ":" + d.GetString("controller") + ":" + sensor
				active[key] = true
				s.notify(app, sc.tankTo, now, sc.id, key, "tank_low", "Tank low",
					fmt.Sprintf("%s on %s is at %.0f%% (low threshold %.0f%%).", tankName(sensor), sc.name, v, sc.lowPct))
			} else if sc.highPct > 0 && v >= sc.highPct {
				key := "tank_high:" + sc.id + ":" + d.GetString("controller") + ":" + sensor
				active[key] = true
				s.notify(app, sc.tankTo, now, sc.id, key, "tank_high", "Tank full",
					fmt.Sprintf("%s on %s is at %.0f%% (high threshold %.0f%%).", tankName(sensor), sc.name, v, sc.highPct))
			}
		}
	}
}

func (s *sweeper) sweepFaults(app core.App, sc siteCtx, now time.Time, active map[string]bool) {
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
		key := "fault:" + sc.id + ":" + rk
		active[key] = true
		s.notify(app, sc.faultTo, now, sc.id, key, "fault", "Fault",
			fmt.Sprintf("%s on %s reported a fault: %s.", e.GetString("controller"), sc.name, reasonText(e.GetString("reason"))))
	}
}

func (s *sweeper) sweepTransitions(app core.App, sc siteCtx, now time.Time) {
	rows, err := app.FindRecordsByFilter("state_events", "site = {:s}", "-ts", 200, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	for _, e := range rows {
		route := e.GetString("route")
		from := e.GetString("from_state")
		to := e.GetString("to_state")
		ts := parseTS(e.GetString("ts"))
		if ts.IsZero() || now.Sub(ts) > faultRecent {
			continue
		}
		base := sc.id + ":" + e.GetString("controller") + ":" + route + ":" + e.GetString("ts")

		// Run started: entered RUNNING from any non-RUNNING state.
		if to == "RUNNING" && from != "RUNNING" {
			key := "run_start:" + base
			s.notify(app, sc.runStartTo, now, sc.id, key, "run_start", "Run started",
				fmt.Sprintf("Route %s on %s at %s has started running.", routeLabel(route), sc.name, e.GetString("controller")))
			continue
		}
		// Run stopped: left RUNNING for IDLE or STOPPING. FAULT is handled by the
		// dedicated fault alert, so we do not double-notify here.
		if from == "RUNNING" && (to == "IDLE" || to == "STOPPING") {
			key := "run_stop:" + base
			reason := reasonText(e.GetString("reason"))
			if reason == "unknown cause" {
				reason = strings.ToLower(to)
			}
			s.notify(app, sc.runStopTo, now, sc.id, key, "run_stop", "Run stopped",
				fmt.Sprintf("Route %s on %s at %s stopped (%s).", routeLabel(route), sc.name, e.GetString("controller"), reason))
		}
	}
}

func routeLabel(route string) string {
	if route == "-1" || route == "" {
		return "controller"
	}
	return route
}

func (s *sweeper) sendEmail(app core.App, to []string, kind, subject, body string) error {
	if !app.Settings().SMTP.Enabled {
		return fmt.Errorf("SMTP is not configured")
	}
	addrs := make([]mail.Address, len(to))
	for i, a := range to {
		addrs[i] = mail.Address{Address: a}
	}
	emoji := alertEmoji[kind]
	if emoji == "" {
		emoji = "🔔"
	}
	msg := &mailer.Message{
		From:    mail.Address{Address: app.Settings().Meta.SenderAddress, Name: app.Settings().Meta.SenderName},
		To:      addrs,
		Subject: emoji + " MajiFlow alert: " + subject,
		HTML:    fmt.Sprintf("<p>%s</p><p style=\"color:#64748b;font-size:12px\">You're receiving this because email alerts are on for your account. Manage them on your account page.</p>", body),
		Text:    body,
	}
	return app.NewMailClient().Send(msg)
}

var alertEmoji = map[string]string{
	"device_offline": "📡",
	"fault":          "🚨",
	"tank_low":       "🚰",
	"tank_high":      "🌊",
	"run_start":      "▶️",
	"run_stop":       "⏹️",
	"test":           "🧪",
}

func (s *sweeper) sendWhatsApp(to []string, kind, subject, body string) error {
	if !s.openwa.configured() {
		return fmt.Errorf("OpenWA is not configured")
	}
	emoji := alertEmoji[kind]
	if emoji == "" {
		emoji = "🔔"
	}
	text := fmt.Sprintf("%s *MajiFlow alert: %s*\n\n%s", emoji, subject, body)
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

// SendWhatsAppTest sends a one-off admin test message to an arbitrary WhatsApp
// number using the same OpenWA configuration and number normalisation as alerts.
func SendWhatsAppTest(raw, countryCode string) (string, error) {
	chatID := normalizeWhatsAppChatID(raw, countryCode)
	if chatID == "" {
		return "", ErrInvalidWhatsAppRecipient
	}
	s := &sweeper{openwa: openWAFromEnv(http.DefaultClient)}
	if err := s.sendWhatsApp([]string{chatID}, "test", "Test notification",
		"This confirms MajiFlow WhatsApp alerts can reach this number."); err != nil {
		return chatID, err
	}
	return chatID, nil
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

func iso(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
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
