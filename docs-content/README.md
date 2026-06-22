# docs-content

The **source of truth** for the non-developer documentation the app shows in every site's
generated document (operation, maintenance, warranty, troubleshooting, the wiring guide, per-node-kind notes, glossary).

These `.md` files are authoritative; the database `docs` collection is a disposable projection that
the per-site document assembler reads at view time. Edit the docs **here**, in the repo — never in
the app.

## Loading a deployment

There is no CLI and no in-app editing. To load or update a deployment's docs:

1. Sign in as an admin → **Docs**.
2. Click **Import from .md** and drop these `docs-content/*.md` files.
3. Review the plan — each file shows as **create** / **update** (matched by slug), with any unknown
   `{{slot}}` flagged as a warning. To make the DB mirror the files exactly, tick the (default-off)
   option to remove docs that are in the DB but not in the import.
4. Confirm. The import upserts by slug, so re-running is idempotent.

## File format

Markdown with frontmatter:

```markdown
---
slug: operation          # the single key. For category: node it IS the node kind (e.g. valve)
title: Operation
category: narrative      # narrative | node | wiring | glossary
order: 10                # display order within the document
---

Body markdown. Use {{slot}} for live values — they fill from the site's topology at view time.
```

## Slots

`{{slot}}` placeholders fill with live values from the site being documented. The vocabulary is
scope-checked (`npm run test:docs` fails on an unknown slot):

- **narrative / wiring / glossary** → site slots: `site_name`, `controller_count`, `tank_count`,
  `pump_count`, `valve_count`, `flow_sensor_count`, `route_count`, `flow_watchdog`, `flow_confirm`,
  `flow_threshold`, `valve_travel_time`, `update_interval`, `commission_date`, `warranty_expiry`.
- **node** (slug = the kind, e.g. `valve`) → the above **plus** `node_kind`, `node_kind_label`, `node_kind_count`.

Board reference docs are **not** here — they ride inside each board's definition
(`BoardDef.documentation`) so a board import is one bundle.
