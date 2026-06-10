// Package alerts sends alert email for away coverage. Everything the user sees
// in-app is derived in the browser from realtime data; this is the one piece
// that cannot move there, because a browser does not run while its tab is shut.
//
// The sweep re-derives the same conditions the frontend does — purely from data
// the server already stores (controller presence, tank-level shadows, fault
// transitions) — and emails the site owner when they opt in. It owns no state
// beyond an in-memory per-incident cooldown, so it needs no alerts table.
package alerts

import (
	"fmt"
	"log"
	"net/mail"
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
	// Re-notify window: one email per incident at most this often, so a stuck
	// condition doesn't spam the owner every tick.
	cooldown = 30 * time.Minute
	// A fault transition older than this is treated as history, not a live alert.
	faultRecent = 30 * time.Minute
)

// RunSweeper runs the alert-email loop until the process exits. Safe to start
// even when SMTP is unconfigured — it simply finds nothing to send (the per-user
// channel_email pref defaults off, and send() no-ops without SMTP).
func RunSweeper(app core.App) {
	s := &sweeper{lastSent: map[string]time.Time{}}
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
}

// shouldSend reports whether a key is outside its cooldown. It does NOT stamp —
// the send time is recorded only after a successful send (see notify), so a
// failed email retries on the next tick instead of going dark for a cooldown.
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

// notify sends one alert email if the key is off cooldown, stamping the cooldown
// only when the send actually succeeds.
func (s *sweeper) notify(app core.App, sc siteCtx, now time.Time, key, subject, body string) {
	if !s.shouldSend(key, now) {
		return
	}
	if err := s.send(app, sc, subject, body); err != nil {
		log.Printf("alerts: email to %s: %v", sc.email, err)
		return
	}
	s.markSent(key, now)
}

type siteCtx struct {
	id        string
	name      string
	email     string
	lowPct    float64
	highPct   float64 // 0 == no high alert
	offlineMs float64
	prefs     prefs
}

type prefs struct {
	offline, fault, tank, email bool
}

func (s *sweeper) run(app core.App, now time.Time) error {
	// Don't bother resolving anything if email can't be sent.
	if !app.Settings().SMTP.Enabled {
		return nil
	}

	sites, err := app.FindAllRecords("sites")
	if err != nil {
		return err
	}
	for _, site := range sites {
		sc, ok := resolveSite(app, site)
		if !ok || !sc.prefs.email {
			continue // no owner email, or owner hasn't opted in
		}
		s.sweepOffline(app, sc, now)
		s.sweepTanks(app, sc, now)
		s.sweepFaults(app, sc, now)
	}
	return nil
}

// resolveSite gathers the owner email, thresholds, and notification prefs for a
// site. ok is false when there is no owner or no owner email.
func resolveSite(app core.App, site *core.Record) (siteCtx, bool) {
	ownerID := site.GetString("owner")
	if ownerID == "" {
		return siteCtx{}, false
	}
	owner, err := app.FindRecordById("users", ownerID)
	if err != nil || owner.GetString("email") == "" {
		return siteCtx{}, false
	}

	low := site.GetFloat("tank_low_pct")
	if low <= 0 {
		low = defaultLowPct
	}
	offMs := site.GetFloat("offline_timeout_s")
	if offMs <= 0 {
		offMs = defaultOfflineSec
	}

	return siteCtx{
		id:        site.Id,
		name:      siteName(site),
		email:     owner.GetString("email"),
		lowPct:    low,
		highPct:   site.GetFloat("tank_high_pct"), // 0 disables high alerts
		offlineMs: offMs * 1000,
		prefs:     resolvePrefs(app, ownerID),
	}, true
}

// resolvePrefs reads the owner's notification_prefs. No row → all alert types on
// but email off (the conservative default), so an unconfigured user is silent.
func resolvePrefs(app core.App, userID string) prefs {
	rec, err := app.FindFirstRecordByFilter("notification_prefs", "user = {:u}", dbx.Params{"u": userID})
	if err != nil || rec == nil {
		return prefs{offline: true, fault: true, tank: true, email: false}
	}
	return prefs{
		offline: rec.GetBool("alert_device_offline"),
		fault:   rec.GetBool("alert_fault"),
		tank:    rec.GetBool("alert_tank"),
		email:   rec.GetBool("channel_email"),
	}
}

func (s *sweeper) sweepOffline(app core.App, sc siteCtx, now time.Time) {
	if !sc.prefs.offline {
		return
	}
	ctrls, err := app.FindRecordsByFilter("controllers", "site = {:s} && active = true", "", 0, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	for _, c := range ctrls {
		seen := c.GetDateTime("last_seen").Time()
		stale := !seen.IsZero() && now.Sub(seen) > time.Duration(sc.offlineMs)*time.Millisecond
		// Only a controller that has connected at least once can be "offline" —
		// a provisioned-but-never-seen device isn't an incident.
		if !seen.IsZero() && (!c.GetBool("online") || stale) {
			s.notify(app, sc, now, "offline:"+c.Id, "Controller offline",
				fmt.Sprintf("%s on %s has gone offline (last seen %s).", c.Id, sc.name, lastSeenText(seen)))
		}
	}
}

func (s *sweeper) sweepTanks(app core.App, sc siteCtx, now time.Time) {
	if !sc.prefs.tank {
		return
	}
	rows, err := app.FindRecordsByFilter("entity_state", "site = {:s} && sensor ~ {:x}", "", 0, 0,
		dbx.Params{"s": sc.id, "x": "_level"})
	if err != nil {
		return
	}
	for _, r := range rows {
		sensor := r.GetString("sensor")
		if !strings.HasSuffix(sensor, "_level") {
			continue
		}
		v := r.GetFloat("reported")
		if v <= sc.lowPct {
			s.notify(app, sc, now, "tanklow:"+sc.id+":"+sensor, "Tank low",
				fmt.Sprintf("%s on %s is at %.0f%% (low threshold %.0f%%).", tankName(sensor), sc.name, v, sc.lowPct))
		} else if sc.highPct > 0 && v >= sc.highPct {
			s.notify(app, sc, now, "tankhigh:"+sc.id+":"+sensor, "Tank full",
				fmt.Sprintf("%s on %s is at %.0f%% (high threshold %.0f%%).", tankName(sensor), sc.name, v, sc.highPct))
		}
	}
}

func (s *sweeper) sweepFaults(app core.App, sc siteCtx, now time.Time) {
	if !sc.prefs.fault {
		return
	}
	// Scan ALL recent transitions (not just FAULT rows) and keep the latest per
	// controller+route, so a route that has since recovered — its latest
	// transition is no longer FAULT — does not alert.
	rows, err := app.FindRecordsByFilter("state_events", "site = {:s}", "-ts", 200, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	seen := map[string]bool{} // first row per key == latest (sorted -ts)
	for _, e := range rows {
		rk := e.GetString("controller") + ":" + e.GetString("route")
		if seen[rk] {
			continue
		}
		seen[rk] = true
		if e.GetString("to_state") != "FAULT" {
			continue // latest transition isn't a fault — route is fine
		}
		ts := parseTS(e.GetString("ts"))
		if ts.IsZero() || now.Sub(ts) > faultRecent {
			continue
		}
		s.notify(app, sc, now, "fault:"+sc.id+":"+rk, "Fault",
			fmt.Sprintf("%s on %s reported a fault: %s.", e.GetString("controller"), sc.name, reasonText(e.GetString("reason"))))
	}
}

// send dispatches one alert email to the site owner. The caller (notify) decides
// whether to stamp the cooldown based on the returned error, so a flaky SMTP
// server retries next tick instead of suppressing the alert.
func (s *sweeper) send(app core.App, sc siteCtx, subject, body string) error {
	msg := &mailer.Message{
		From:    mail.Address{Address: app.Settings().Meta.SenderAddress, Name: app.Settings().Meta.SenderName},
		To:      []mail.Address{{Address: sc.email}},
		Subject: "MajiFlow alert: " + subject,
		HTML:    fmt.Sprintf("<p>%s</p><p style=\"color:#64748b;font-size:12px\">You're receiving this because email alerts are on for your account. Manage them on your account page.</p>", body),
		Text:    body,
	}
	return app.NewMailClient().Send(msg)
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
