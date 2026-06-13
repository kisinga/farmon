package api_test

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/kisinga/majiflow/internal/api"
	"github.com/kisinga/majiflow/internal/config"
	_ "github.com/kisinga/majiflow/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// capturingPublisher records every publish so a test can assert what reached the broker.
type capturingPublisher struct {
	msgs []struct {
		topic   string
		payload []byte
	}
}

func (p *capturingPublisher) Publish(topic string, payload []byte, _ bool, _ byte) error {
	p.msgs = append(p.msgs, struct {
		topic   string
		payload []byte
	}{topic, append([]byte(nil), payload...)})
	return nil
}

// failingPublisher always errors — to assert a release is not left "deployed" when
// the command never reaches the broker.
type failingPublisher struct{}

func (failingPublisher) Publish(string, []byte, bool, byte) error {
	return fmt.Errorf("broker down")
}

// seed creates a site (id site11111111111), an admin user, and a controller (id dev1), returning
// the admin's auth token. Fixed ids let the request bodies be static.
func seed(t testing.TB, app core.App) string {
	t.Helper()
	save := func(r *core.Record) {
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	rec := func(coll string) *core.Record {
		c, err := app.FindCollectionByNameOrId(coll)
		if err != nil {
			t.Fatal(err)
		}
		return core.NewRecord(c)
	}
	site := rec("sites")
	site.Id = "site11111111111"
	site.Set("name", "S")
	save(site)

	admin := rec("users")
	admin.Set("email", "admin@x.com")
	admin.Set("password", "password123")
	admin.Set("role", "admin")
	admin.Set("verified", true)
	save(admin)

	ctrl := rec("controllers")
	ctrl.Id = "dev1"
	ctrl.Set("site", "site11111111111")
	ctrl.Set("active", true)
	save(ctrl)

	tok, err := admin.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// seedRelease adds a deployable firmware_releases row (id rel111111111111) with a real stored
// binary so deploy/download have a file to work with.
func seedRelease(t testing.TB, app core.App, downloadToken string) {
	t.Helper()
	c, err := app.FindCollectionByNameOrId("firmware_releases")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	r.Id = "rel111111111111"
	r.Set("site", "site11111111111")
	r.Set("controller", "dev1")
	r.Set("version", "v9")
	r.Set("md5", "deadbeef")
	r.Set("status", "uploaded")
	if downloadToken != "" {
		r.Set("download_token", downloadToken)
		r.Set("download_expires", "2999-01-01 00:00:00.000Z")
	}
	f, err := filesystem.NewFileFromBytes([]byte("FIRMWARE"), "fw.bin")
	if err != nil {
		t.Fatal(err)
	}
	r.Set("firmware_bin", f)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
}

// Upload without a session is rejected — the device secret must never gate uploads;
// only an authenticated admin/owner may push code.
func TestFirmwareUploadRequiresAuth(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("site", "site11111111111")
	_ = w.WriteField("controller", "dev1")
	fw, _ := w.CreateFormFile("firmware_bin", "fw.bin")
	_, _ = fw.Write([]byte("HELLO"))
	_ = w.Close()

	scenario := tests.ApiScenario{
		Name:            "upload requires auth",
		Method:          http.MethodPost,
		URL:             "/api/farmon/firmware",
		Body:            &body,
		Headers:         map[string]string{"Content-Type": w.FormDataContentType()},
		ExpectedStatus:  401,
		ExpectedContent: []string{"Authentication required"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seed(t, app)
			api.Register(e, config.Config{Mode: config.ModeEdge}, &capturingPublisher{})
		},
	}
	scenario.Test(t)
}

// Upload happy path: an admin posts a binary; the server computes the md5 itself and
// records an "uploaded" release.
func TestFirmwareUploadComputesMd5(t *testing.T) {
	headers := map[string]string{}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("site", "site11111111111")
	_ = w.WriteField("controller", "dev1")
	_ = w.WriteField("version", "v9")
	fw, _ := w.CreateFormFile("firmware_bin", "fw.bin")
	_, _ = fw.Write([]byte("HELLO"))
	_ = w.Close()
	headers["Content-Type"] = w.FormDataContentType()
	wantMd5 := fmt.Sprintf("%x", md5.Sum([]byte("HELLO")))

	scenario := tests.ApiScenario{
		Name:            "upload computes md5",
		Method:          http.MethodPost,
		URL:             "/api/farmon/firmware",
		Body:            &body,
		Headers:         headers,
		ExpectedStatus:  200,
		ExpectedContent: []string{wantMd5},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			headers["Authorization"] = seed(t, app)
			api.Register(e, config.Config{Mode: config.ModeEdge}, &capturingPublisher{})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			r, err := app.FindFirstRecordByFilter("firmware_releases",
				"controller = {:c}", dbx.Params{"c": "dev1"})
			if err != nil || r == nil {
				t.Fatalf("no firmware_releases row created: %v", err)
			}
			if r.GetString("md5") != wantMd5 {
				t.Fatalf("md5 = %q, want %q", r.GetString("md5"), wantMd5)
			}
			if r.GetString("status") != "uploaded" || r.GetString("version") != "v9" {
				t.Fatalf("unexpected status/version: %s/%s", r.GetString("status"), r.GetString("version"))
			}
		},
	}
	scenario.Test(t)
}

// Deploy publishes a firmware_update command on the controller's command topic and
// marks the release deployed.
func TestFirmwareDeployPublishesCommand(t *testing.T) {
	headers := map[string]string{}
	pub := &capturingPublisher{}

	scenario := tests.ApiScenario{
		Name:            "deploy publishes firmware_update",
		Method:          http.MethodPost,
		URL:             "/api/farmon/firmware/deploy",
		Body:            strings.NewReader(`{"site":"site11111111111","controller":"dev1","release_id":"rel111111111111"}`),
		Headers:         headers,
		ExpectedStatus:  200,
		ExpectedContent: []string{"deployed"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			headers["Authorization"] = seed(t, app)
			seedRelease(t, app, "")
			api.Register(e, config.Config{Mode: config.ModeEdge}, pub)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if len(pub.msgs) != 1 {
				t.Fatalf("expected 1 published command, got %d", len(pub.msgs))
			}
			m := pub.msgs[0]
			if m.topic != "majiflow/site11111111111/dev1/command" {
				t.Fatalf("published on wrong topic: %s", m.topic)
			}
			var env map[string]any
			if err := json.Unmarshal(m.payload, &env); err != nil {
				t.Fatal(err)
			}
			if env["action"] != "firmware_update" {
				t.Fatalf("action = %v, want firmware_update", env["action"])
			}
			if url, _ := env["url"].(string); !strings.Contains(url, "/api/farmon/firmware/rel111111111111?t=") {
				t.Fatalf("command url missing token-gated download: %v", env["url"])
			}
			r, _ := app.FindRecordById("firmware_releases", "rel111111111111")
			if r.GetString("status") != "deployed" {
				t.Fatalf("release status = %q, want deployed", r.GetString("status"))
			}
		},
	}
	scenario.Test(t)
}

// The device download endpoint rejects a wrong capability token.
func TestFirmwareDownloadRejectsBadToken(t *testing.T) {
	scenario := tests.ApiScenario{
		Name:            "download rejects bad token",
		Method:          http.MethodGet,
		URL:             "/api/farmon/firmware/rel111111111111?t=wrong",
		ExpectedStatus:  403,
		ExpectedContent: []string{"Invalid token"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seed(t, app)
			seedRelease(t, app, "secret-token")
			api.Register(e, config.Config{Mode: config.ModeEdge}, &capturingPublisher{})
		},
	}
	scenario.Test(t)
}

// The device download endpoint serves the binary when the capability token matches.
func TestFirmwareDownloadServesWithGoodToken(t *testing.T) {
	scenario := tests.ApiScenario{
		Name:            "download serves with good token",
		Method:          http.MethodGet,
		URL:             "/api/farmon/firmware/rel111111111111?t=secret-token",
		ExpectedStatus:  200,
		ExpectedContent: []string{"FIRMWARE"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seed(t, app)
			seedRelease(t, app, "secret-token")
			api.Register(e, config.Config{Mode: config.ModeEdge}, &capturingPublisher{})
		},
	}
	scenario.Test(t)
}

// Upload without a version is rejected — version is the device-side idempotency key.
func TestFirmwareUploadRequiresVersion(t *testing.T) {
	headers := map[string]string{}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("site", "site11111111111")
	_ = w.WriteField("controller", "dev1")
	// no version field
	fw, _ := w.CreateFormFile("firmware_bin", "fw.bin")
	_, _ = fw.Write([]byte("HELLO"))
	_ = w.Close()
	headers["Content-Type"] = w.FormDataContentType()

	scenario := tests.ApiScenario{
		Name:            "upload requires version",
		Method:          http.MethodPost,
		URL:             "/api/farmon/firmware",
		Body:            &body,
		Headers:         headers,
		ExpectedStatus:  400,
		ExpectedContent: []string{"Version is required"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			headers["Authorization"] = seed(t, app)
			api.Register(e, config.Config{Mode: config.ModeEdge}, &capturingPublisher{})
		},
	}
	scenario.Test(t)
}

// A publish failure must not leave the release reading "deployed" — it should flip to
// "failed" so the UI is honest and the admin re-deploys.
func TestFirmwareDeployPublishFailureMarksFailed(t *testing.T) {
	headers := map[string]string{}

	scenario := tests.ApiScenario{
		Name:            "deploy publish failure marks failed",
		Method:          http.MethodPost,
		URL:             "/api/farmon/firmware/deploy",
		Body:            strings.NewReader(`{"site":"site11111111111","controller":"dev1","release_id":"rel111111111111"}`),
		Headers:         headers,
		ExpectedStatus:  502,
		ExpectedContent: []string{"Failed to publish command"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			headers["Authorization"] = seed(t, app)
			seedRelease(t, app, "")
			api.Register(e, config.Config{Mode: config.ModeEdge}, failingPublisher{})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			r, _ := app.FindRecordById("firmware_releases", "rel111111111111")
			if r.GetString("status") != "failed" {
				t.Fatalf("release status = %q, want failed", r.GetString("status"))
			}
		},
	}
	scenario.Test(t)
}
