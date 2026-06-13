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
	// Floor for a positive offline_timeout_s: it must stay well above the telemetry
	// cadence (update_interval, capped at 60s) so a healthy device's normal gap
	// between samples can never read as offline. 0 still means "use the default".
	offlineFloorSec = 120.0
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

// notify sends one alert email to `to` if the key is off cooldown, stamping the
// cooldown only when the send actually succeeds. A nil/empty `to` is a no-op.
func (s *sweeper) notify(app core.App, to []string, now time.Time, key, subject, body string) {
	if len(to) == 0 || !s.shouldSend(key, now) {
		return
	}
	if err := s.send(app, to, subject, body); err != nil {
		log.Printf("alerts: email to %v: %v", to, err)
		return
	}
	s.markSent(key, now)
}

// siteCtx carries a site's thresholds plus the per-alert recipient lists — the
// co-owners who turned on email and that specific alert type. A site has a set of
// equal co-owners, each with their own notification prefs, so the same incident
// reaches exactly those who asked for it.
type siteCtx struct {
	id        string
	name      string
	lowPct    float64
	highPct   float64 // 0 == no high alert
	offlineMs float64
	offlineTo []string
	faultTo   []string
	tankTo    []string
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
		if !ok {
			continue // no co-owner opted into any email alert
		}
		s.sweepOffline(app, sc, now)
		s.sweepTanks(app, sc, now)
		s.sweepFaults(app, sc, now)
	}
	return nil
}

// resolveSite gathers a site's thresholds and the per-alert recipient lists. Each
// co-owner contributes their email to the alert types they enabled (with email on
// as the master switch). ok is false when no co-owner wants any email alert.
func resolveSite(app core.App, site *core.Record) (siteCtx, bool) {
	ownerIDs := site.GetStringSlice("owner")
	if len(ownerIDs) == 0 {
		return siteCtx{}, false
	}

	var offlineTo, faultTo, tankTo []string
	for _, ownerID := range ownerIDs {
		owner, err := app.FindRecordById("users", ownerID)
		if err != nil {
			continue
		}
		email := owner.GetString("email")
		if email == "" {
			continue
		}
		p := resolvePrefs(app, ownerID)
		if !p.email {
			continue // email channel off — this co-owner gets nothing
		}
		if p.offline {
			offlineTo = append(offlineTo, email)
		}
		if p.fault {
			faultTo = append(faultTo, email)
		}
		if p.tank {
			tankTo = append(tankTo, email)
		}
	}
	if len(offlineTo) == 0 && len(faultTo) == 0 && len(tankTo) == 0 {
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

// resolvePrefs reads the owner's notification_prefs. No row → all alert types on
// but email off (the conservative default), so an unconfigured user is silent.
func resolvePrefs(app core.App, userID string) prefs {
	rec, err := app.FindFirstRecordByFilter("notification_prefs", "user = {:u}", dbx.Params{"u": userID})
	if err != nil || rec == nil {
		// Offline is opt-in (a flaky link drops constantly → noisiest alert); the
		// rest default on. Mirrors DEFAULT_NOTIFICATION_PREFS in the frontend.
		return prefs{offline: false, fault: true, tank: true, email: false}
	}
	return prefs{
		offline: rec.GetBool("alert_device_offline"),
		fault:   rec.GetBool("alert_fault"),
		tank:    rec.GetBool("alert_tank"),
		email:   rec.GetBool("channel_email"),
	}
}

func (s *sweeper) sweepOffline(app core.App, sc siteCtx, now time.Time) {
	if len(sc.offlineTo) == 0 {
		return
	}
	ctrls, err := app.FindRecordsByFilter("controllers", "site = {:s} && active = true", "", 0, 0, dbx.Params{"s": sc.id})
	if err != nil {
		return
	}
	for _, c := range ctrls {
		seen := c.GetDateTime("last_seen").Time()
		// Staleness only — the `online` flag is NOT consulted here. The flag flips
		// false on any brief broker drop (a fast reconnect re-sets it), so alerting on
		// it would email on every transient blip; last_seen aging past the timeout is
		// the naturally-debounced signal. A zero last_seen (provisioned, never seen)
		// can't be stale, so a never-connected device is correctly not an incident.
		stale := !seen.IsZero() && now.Sub(seen) > time.Duration(sc.offlineMs)*time.Millisecond
		if stale {
			s.notify(app, sc.offlineTo, now, "offline:"+c.Id, "Controller offline",
				fmt.Sprintf("%s on %s has gone offline (last seen %s).", c.Id, sc.name, lastSeenText(seen)))
		}
	}
}

func (s *sweeper) sweepTanks(app core.App, sc siteCtx, now time.Time) {
	if len(sc.tankTo) == 0 {
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
			s.notify(app, sc.tankTo, now, "tanklow:"+sc.id+":"+sensor, "Tank low",
				fmt.Sprintf("%s on %s is at %.0f%% (low threshold %.0f%%).", tankName(sensor), sc.name, v, sc.lowPct))
		} else if sc.highPct > 0 && v >= sc.highPct {
			s.notify(app, sc.tankTo, now, "tankhigh:"+sc.id+":"+sensor, "Tank full",
				fmt.Sprintf("%s on %s is at %.0f%% (high threshold %.0f%%).", tankName(sensor), sc.name, v, sc.highPct))
		}
	}
}

func (s *sweeper) sweepFaults(app core.App, sc siteCtx, now time.Time) {
	if len(sc.faultTo) == 0 {
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
		s.notify(app, sc.faultTo, now, "fault:"+sc.id+":"+rk, "Fault",
			fmt.Sprintf("%s on %s reported a fault: %s.", e.GetString("controller"), sc.name, reasonText(e.GetString("reason"))))
	}
}

// send dispatches one alert email to every recipient (the site's co-owners who
// opted into this alert). The caller (notify) decides whether to stamp the
// cooldown based on the returned error, so a flaky SMTP server retries next tick
// instead of suppressing the alert.
func (s *sweeper) send(app core.App, to []string, subject, body string) error {
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
