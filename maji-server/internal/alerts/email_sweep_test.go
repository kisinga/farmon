package alerts

import (
	"context"
	"errors"
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
