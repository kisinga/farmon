package server

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

// registerDocsCmd adds `docs export|import [dir]`, the round-trip between the
// `docs` collection (runtime SSOT) and `docs-content/*.md` (git-committed
// snapshot, markdown + frontmatter). Both are manual, human-run — the DB stays
// the source of truth; git is for history/review (the "sync is a human problem"
// choice). `import` is also the one-time vehicle for the initial content
// migration (it upserts by slug, so re-running is idempotent).
func registerDocsCmd(app *pocketbase.PocketBase) {
	docsCmd := &cobra.Command{Use: "docs", Short: "Documentation content tools"}
	docsCmd.AddCommand(&cobra.Command{
		Use:   "export [dir]",
		Short: "Export the docs collection to markdown files for committing to git",
		Run: func(_ *cobra.Command, args []string) {
			n, err := exportDocs(app, docsDir(args))
			if err != nil {
				fmt.Fprintln(os.Stderr, "docs export failed:", err)
				os.Exit(1)
			}
			fmt.Printf("exported %d docs to %s\n", n, docsDir(args))
		},
	})
	docsCmd.AddCommand(&cobra.Command{
		Use:   "import [dir]",
		Short: "Upsert docs into the collection from markdown files (by slug)",
		Run: func(_ *cobra.Command, args []string) {
			n, err := importDocs(app, docsDir(args))
			if err != nil {
				fmt.Fprintln(os.Stderr, "docs import failed:", err)
				os.Exit(1)
			}
			fmt.Printf("imported %d docs from %s\n", n, docsDir(args))
		},
	})
	app.RootCmd.AddCommand(docsCmd)
}

func docsDir(args []string) string {
	if len(args) > 0 {
		return args[0]
	}
	return "docs-content"
}

func exportDocs(app core.App, dir string) (int, error) {
	records, err := app.FindAllRecords("docs")
	if err != nil {
		return 0, err
	}
	// Deterministic on disk: category, then order, then slug.
	sort.Slice(records, func(i, j int) bool {
		a, b := records[i], records[j]
		if a.GetString("category") != b.GetString("category") {
			return a.GetString("category") < b.GetString("category")
		}
		if ao, bo := a.GetInt("order"), b.GetInt("order"); ao != bo {
			return ao < bo
		}
		return a.GetString("slug") < b.GetString("slug")
	})
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	for _, r := range records {
		slug := r.GetString("slug")
		if slug == "" {
			slug = r.Id
		}
		var b strings.Builder
		b.WriteString("---\n")
		fmt.Fprintf(&b, "slug: %s\n", slug)
		fmt.Fprintf(&b, "title: %s\n", r.GetString("title"))
		fmt.Fprintf(&b, "category: %s\n", r.GetString("category"))
		fmt.Fprintf(&b, "order: %d\n", r.GetInt("order"))
		b.WriteString("---\n\n")
		b.WriteString(r.GetString("body"))
		b.WriteString("\n")

		safe := strings.ReplaceAll(slug, "/", "-")
		if err := os.WriteFile(filepath.Join(dir, safe+".md"), []byte(b.String()), 0o644); err != nil {
			return 0, err
		}
	}
	return len(records), nil
}

func importDocs(app core.App, dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	coll, err := app.FindCollectionByNameOrId("docs")
	if err != nil {
		return 0, err
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return count, err
		}
		fm, body := parseFrontmatter(string(raw))
		if fm["category"] == "" {
			continue // not a doc (e.g. README) — no frontmatter
		}
		slug := fm["slug"]
		if slug == "" {
			slug = strings.TrimSuffix(e.Name(), ".md")
		}

		// Upsert by slug — re-running import is idempotent.
		rec, err := app.FindFirstRecordByData("docs", "slug", slug)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return count, err // a real DB error, not "no such slug yet"
		}
		if rec == nil {
			rec = core.NewRecord(coll)
		}
		rec.Set("slug", slug)
		rec.Set("title", fm["title"])
		rec.Set("category", fm["category"])
		if n, convErr := strconv.Atoi(fm["order"]); convErr == nil {
			rec.Set("order", n)
		}
		rec.Set("body", body)
		if err := app.Save(rec); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// parseFrontmatter splits a leading `---\nkey: value\n---\n` block from the body.
// Minimal by design (the keys are known, single-line scalars).
func parseFrontmatter(s string) (map[string]string, string) {
	fm := map[string]string{}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.HasPrefix(s, "---\n") {
		return fm, s
	}
	end := strings.Index(s[4:], "\n---")
	if end < 0 {
		return fm, s
	}
	header := s[4 : 4+end]
	rest := s[4+end+4:] // past the closing "\n---"
	rest = strings.TrimPrefix(rest, "\n")
	rest = strings.TrimPrefix(rest, "\n")
	for _, line := range strings.Split(header, "\n") {
		if i := strings.Index(line, ":"); i >= 0 {
			fm[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	return fm, rest
}
