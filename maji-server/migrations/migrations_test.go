package migrations_test

import (
	"os"
	"strings"
	"testing"

	_ "github.com/kisinga/majiflow/migrations" // register the Go migrations
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Every registered migration must apply cleanly on a fresh database, leaving the
// expected end-state schema. Catches a broken/renumbered migration in CI rather
// than at deploy. (NewTestApp boots a temp app and runs all registered migrations.)
func TestMigrationsApplyCleanly(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("migrations did not apply on a fresh database: %v", err)
	}
	defer app.Cleanup()

	// 23_automations created the collection.
	if _, err := app.FindCollectionByNameOrId("automations"); err != nil {
		t.Fatalf("automations collection missing: %v", err)
	}

	commands, err := app.FindCollectionByNameOrId("commands")
	if err != nil {
		t.Fatalf("commands collection missing: %v", err)
	}
	// 25_drop_automation_command removed the field...
	if commands.Fields.GetByName("automation_id") != nil {
		t.Error("commands.automation_id should have been dropped (migration 25)")
	}
	// ...and the action enum value.
	action, ok := commands.Fields.GetByName("action").(*core.SelectField)
	if !ok {
		t.Fatal("commands.action is not a select field")
	}
	for _, v := range action.Values {
		if v == "automation_set" {
			t.Error("commands.action still offers automation_set (migration 25)")
		}
	}
	// 30_command_node added the actuator-target fields the command history reads.
	if commands.Fields.GetByName("node_id") == nil {
		t.Error("commands.node_id should exist (migration 30)")
	}
	if commands.Fields.GetByName("node_on") == nil {
		t.Error("commands.node_on should exist (migration 30)")
	}
}

// Each migration file must have a unique NN_ number. Two files sharing a number
// (e.g. a merge adding 24_x while 24_y already exists) makes apply order ambiguous
// — exactly the collision that prompted this guard.
func TestMigrationNumbersUnique(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		num, _, found := strings.Cut(name, "_")
		if !found {
			continue // helper file without a number prefix
		}
		if prev, dup := seen[num]; dup {
			t.Errorf("duplicate migration number %q: %s and %s", num, prev, name)
		}
		seen[num] = name
	}
}
