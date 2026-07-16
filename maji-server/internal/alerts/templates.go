package alerts

import (
	"bytes"
	"log"
	"text/template"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// templateKey prefixes the alert kind, matching the notification_templates rows
// (and the notification_prefs field naming): kind "tank_low" → "alert_tank_low".
func templateKey(kind string) string { return "alert_" + kind }

// renderTemplate overlays the operator-editable copy for (kind, channel) onto
// the built-in fallback. A missing/inactive row, an empty field, or a render
// error all return the fallback unchanged, so adding or breaking a template can
// never silence an alert — at worst it reads like it always did.
func renderTemplate(app core.App, kind, channel string, vars map[string]string, fbSubject, fbBody string) (string, string) {
	rec, err := app.FindFirstRecordByFilter("notification_templates",
		"key = {:k} && channel = {:c} && active = true",
		dbx.Params{"k": templateKey(kind), "c": channel})
	if err != nil || rec == nil {
		return fbSubject, fbBody
	}
	return executeTemplate(kind, rec.GetString("subject"), vars, fbSubject),
		executeTemplate(kind, rec.GetString("body"), vars, fbBody)
}

func executeTemplate(kind, text string, vars map[string]string, fallback string) string {
	if text == "" {
		return fallback
	}
	t, err := template.New(kind).Option("missingkey=zero").Parse(text)
	if err != nil {
		log.Printf("alerts: template %s parse: %v", kind, err)
		return fallback
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		log.Printf("alerts: template %s render: %v", kind, err)
		return fallback
	}
	return buf.String()
}
