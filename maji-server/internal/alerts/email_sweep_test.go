package alerts

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

type fakeWhatsApp struct {
	sent []string
	err  error
}

func (f *fakeWhatsApp) configured() bool { return true }

func (f *fakeWhatsApp) sendText(_ context.Context, chatID, text string) error {
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, chatID+"|"+text)
	return nil
}

func TestTankIncidentSendsOnceUntilResolved(t *testing.T) {
	app, site, state := setupAlertSite(t)
	defer app.Cleanup()

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("first active incident should send once, got %d sends", got)
	}

	if err := s.run(app, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("same active incident should not resend, got %d sends", got)
	}

	state.Set("snapshot", `{"readings":{"main_tank_level":45}}`)
	saveRec(t, app, state)
	if err := s.run(app, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	inc, _ := app.FindFirstRecordByFilter("notification_incidents",
		"site = {:s} && kind = 'tank_low'", dbx.Params{"s": site.Id})
	if inc == nil || inc.GetString("status") != "resolved" {
		t.Fatalf("cleared tank condition should resolve incident, got %v", inc)
	}

	state.Set("snapshot", `{"readings":{"main_tank_level":10}}`)
	saveRec(t, app, state)
	if err := s.run(app, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 2 {
		t.Fatalf("resolved incident should re-arm and send on recurrence, got %d sends", got)
	}
}

func TestFailedIncidentDeliveryRetries(t *testing.T) {
	app, _, _ := setupAlertSite(t)
	defer app.Cleanup()

	wa := &fakeWhatsApp{err: errors.New("network down")}
	s := &sweeper{openwa: wa}
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 0 {
		t.Fatalf("failed send should not record success, got %d sends", got)
	}

	wa.err = nil
	if err := s.run(app, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("unsent incident should retry next sweep, got %d sends", got)
	}
}

func TestRecipientsDedupe(t *testing.T) {
	var r recipients
	r.addEmail("ops@example.com")
	r.addEmail("OPS@example.com")
	r.addWhatsApp("254712345678@c.us")
	r.addWhatsApp("254712345678@c.us")
	if len(r.email) != 1 || len(r.whatsapp) != 1 {
		t.Fatalf("recipients not deduped: %+v", r)
	}
}

func TestSendWhatsAppTestRejectsInvalidNumber(t *testing.T) {
	if _, err := SendWhatsAppTest("not a number", "254"); !errors.Is(err, ErrInvalidWhatsAppRecipient) {
		t.Fatalf("expected invalid recipient error, got %v", err)
	}
}

func TestFaultIncidentSendsWhatsApp(t *testing.T) {
	app, site, _ := setupAlertSite(t)
	defer app.Cleanup()

	// Re-wire the prefs row from the tank fixture to opt into fault + WhatsApp.
	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_fault", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")

	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)
	ev := newRec(t, app, "state_events")
	ev.Set("site", site.Id)
	ev.Set("controller", ctrl.Id)
	ev.Set("route", 0)
	ev.Set("from_state", "RUNNING")
	ev.Set("to_state", "FAULT")
	ev.Set("reason", "NO_FLOW")
	ev.Set("ts", now.Format(time.RFC3339))
	saveRec(t, app, ev)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("fault transition should send one WhatsApp, got %d", got)
	}
	if !strings.Contains(wa.sent[0], "254712345678@c.us") {
		t.Fatalf("expected normalized Kenyan chat id, got %q", wa.sent[0])
	}
}

func TestStaleFaultDoesNotSendWhatsApp(t *testing.T) {
	app, site, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_fault", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")

	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)
	ev := newRec(t, app, "state_events")
	ev.Set("site", site.Id)
	ev.Set("controller", ctrl.Id)
	ev.Set("route", 0)
	ev.Set("from_state", "RUNNING")
	ev.Set("to_state", "FAULT")
	ev.Set("reason", "NO_FLOW")
	ev.Set("ts", now.Add(-31*time.Minute).Format(time.RFC3339))
	saveRec(t, app, ev)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 0 {
		t.Fatalf("stale fault transition should not send, got %d", got)
	}
}

func TestRunStartAndStopSendWhatsApp(t *testing.T) {
	app, site, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_run_start", true)
		prefs.Set("alert_run_stop", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	start := newRec(t, app, "state_events")
	start.Set("site", site.Id)
	start.Set("controller", ctrl.Id)
	start.Set("route", 1)
	start.Set("from_state", "IDLE")
	start.Set("to_state", "RUNNING")
	start.Set("reason", "")
	start.Set("ts", now.Format(time.RFC3339))
	saveRec(t, app, start)

	stop := newRec(t, app, "state_events")
	stop.Set("site", site.Id)
	stop.Set("controller", ctrl.Id)
	stop.Set("route", 1)
	stop.Set("from_state", "RUNNING")
	stop.Set("to_state", "IDLE")
	stop.Set("reason", "MAX_RUNTIME")
	stop.Set("ts", now.Add(2*time.Minute).Format(time.RFC3339))
	saveRec(t, app, stop)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 2 {
		t.Fatalf("expected run start + run stop (2 sends), got %d", got)
	}
	if !strings.Contains(wa.sent[0], "Run stopped") {
		t.Fatalf("latest event should be run stop, got %q", wa.sent[0])
	}
	if !strings.Contains(wa.sent[1], "Run started") {
		t.Fatalf("older event should be run start, got %q", wa.sent[1])
	}
}

func TestWhatsAppFallbackToProfilePhone(t *testing.T) {
	app, _, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	user, _ := app.FindRecordById("users", prefs.GetString("user"))
	user.Set("phone", "+254712345678")
	saveRec(t, app, user)
	prefs.Set("alert_tank", true)
	prefs.Set("channel_whatsapp", true)
	prefs.Set("whatsapp_chat_id", "")
	saveRec(t, app, prefs)

	// site threshold default low 20, snapshot level 10 -> tank_low alert.
	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)
	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("expected one WhatsApp using profile phone fallback, got %d", got)
	}
	if !strings.Contains(wa.sent[0], "254712345678@c.us") {
		t.Fatalf("expected normalized profile phone chat id, got %q", wa.sent[0])
	}
}

func TestRunTransitionDedupedByTimestamp(t *testing.T) {
	app, site, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_run_start", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	start := newRec(t, app, "state_events")
	start.Set("site", site.Id)
	start.Set("controller", ctrl.Id)
	start.Set("route", 1)
	start.Set("from_state", "IDLE")
	start.Set("to_state", "RUNNING")
	start.Set("reason", "")
	start.Set("ts", now.Format(time.RFC3339))
	saveRec(t, app, start)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("first sweep should send once, got %d", got)
	}
	if err := s.run(app, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("same transition should not resend, got %d", got)
	}
}

func TestOfflineAndOnlineNotifications(t *testing.T) {
	app, _, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_device_offline", true)
		prefs.Set("alert_device_online", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	// Stale controller triggers offline alert.
	ctrl.Set("last_seen", now.Add(-5*time.Minute))
	saveRec(t, app, ctrl)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("expected one offline notification, got %d", got)
	}
	if !strings.Contains(wa.sent[0], "Controller offline") {
		t.Fatalf("expected offline subject, got %q", wa.sent[0])
	}

	// Fresh controller resolves the incident and sends a recovery alert.
	ctrl.Set("last_seen", now)
	saveRec(t, app, ctrl)
	if err := s.run(app, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 2 {
		t.Fatalf("expected offline + online notifications (2 sends), got %d", got)
	}
	if !strings.Contains(wa.sent[1], "Controller back online") {
		t.Fatalf("expected online subject, got %q", wa.sent[1])
	}
	if !strings.Contains(wa.sent[1], "after 6m") {
		t.Fatalf("expected offline duration in online message, got %q", wa.sent[1])
	}

	// Subsequent sweeps should not resend the recovery alert.
	if err := s.run(app, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 2 {
		t.Fatalf("same online episode should not resend, got %d", got)
	}

	// Going offline again should re-arm and send a new offline notification.
	ctrl.Set("last_seen", now.Add(-5*time.Minute))
	saveRec(t, app, ctrl)
	if err := s.run(app, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 3 {
		t.Fatalf("expected re-armed offline notification, got %d", got)
	}
}

// A failed recovery delivery must leave the incident active so the next sweep
// retries — resolving it silently was how back-online notifications vanished on
// any transient WhatsApp/SMTP error.
func TestOnlineDeliveryFailureRetries(t *testing.T) {
	app, _, _ := setupAlertSite(t)
	defer app.Cleanup()

	prefs, _ := app.FindFirstRecordByFilter("notification_prefs", "user != ''", dbx.Params{})
	if prefs != nil {
		prefs.Set("alert_tank", false)
		prefs.Set("alert_device_offline", true)
		prefs.Set("alert_device_online", true)
		saveRec(t, app, prefs)
	}

	ctrl, _ := app.FindRecordById("controllers", "ctrl1")
	now := time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC)

	ctrl.Set("last_seen", now.Add(-5*time.Minute))
	saveRec(t, app, ctrl)

	wa := &fakeWhatsApp{}
	s := &sweeper{openwa: wa}
	if err := s.run(app, now); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("expected one offline notification, got %d", got)
	}

	// Controller recovers while the WhatsApp lane is down: no send, and the
	// incident must stay active.
	wa.err = errors.New("network down")
	ctrl.Set("last_seen", now.Add(time.Minute))
	saveRec(t, app, ctrl)
	if err := s.run(app, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 1 {
		t.Fatalf("failed recovery should not record a send, got %d", got)
	}
	inc, _ := app.FindFirstRecordByFilter("notification_incidents",
		"kind = 'device_offline' && status = 'active'", dbx.Params{})
	if inc == nil {
		t.Fatal("failed recovery delivery must leave the offline incident active for retry")
	}

	// Lane back up: the next sweep delivers the recovery and resolves.
	wa.err = nil
	if err := s.run(app, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := len(wa.sent); got != 2 {
		t.Fatalf("expected retried recovery notification, got %d sends", got)
	}
	if !strings.Contains(wa.sent[1], "Controller back online") {
		t.Fatalf("expected online subject, got %q", wa.sent[1])
	}
}

func setupAlertSite(t *testing.T) (*tests.TestApp, *core.Record, *core.Record) {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}

	user := newRec(t, app, "users")
	user.Set("email", "owner@example.com")
	user.Set("password", "password123")
	user.Set("role", "customer")
	saveRec(t, app, user)

	site := newRec(t, app, "sites")
	site.Set("name", "Pump House")
	site.Set("owner", []string{user.Id})
	site.Set("tank_low_pct", 20)
	saveRec(t, app, site)

	ctrl := newRec(t, app, "controllers")
	ctrl.Id = "ctrl1"
	ctrl.Set("site", site.Id)
	ctrl.Set("active", true)
	ctrl.Set("last_seen", time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC))
	saveRec(t, app, ctrl)

	prefs := newRec(t, app, "notification_prefs")
	prefs.Set("user", user.Id)
	prefs.Set("alert_tank", true)
	prefs.Set("channel_whatsapp", true)
	prefs.Set("whatsapp_chat_id", "0712345678")
	prefs.Set("whatsapp_country_code", "254")
	saveRec(t, app, prefs)

	state := newRec(t, app, "controller_state")
	state.Set("site", site.Id)
	state.Set("controller", ctrl.Id)
	state.Set("snapshot", `{"readings":{"main_tank_level":10}}`)
	state.Set("ts", "2026-07-06T09:00:00Z")
	saveRec(t, app, state)

	return app, site, state
}

func newRec(t *testing.T, app core.App, coll string) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(coll)
	if err != nil {
		t.Fatal(err)
	}
	return core.NewRecord(c)
}

func saveRec(t *testing.T, app core.App, rec *core.Record) {
	t.Helper()
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
}
