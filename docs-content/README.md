# docs-content

Git-committed snapshot of the **non-developer documentation** that the app shows in every site's
generated document (operation, troubleshooting, the wiring guide, per-node-kind notes, glossary).

The **database `docs` collection is the source of truth** — it's authored at runtime in the app
(admin → **Docs**). These files are the human-readable mirror for history and review; the sync is
manual, by design.

## Round-trip

```sh
# load these files into the DB (upsert by slug — idempotent; also the one-time migration vehicle)
maji-cloud docs import [dir]      # default dir: docs-content

# dump the DB back to these files after editing in the app
maji-cloud docs export [dir]
```

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
  `flow_threshold`, `valve_travel_time`, `update_interval`.
- **node** (slug = the kind, e.g. `valve`) → the above **plus** `node_kind`, `node_kind_label`, `node_kind_count`.

Board reference docs are **not** here — they ride inside each board's definition
(`BoardDef.documentation`) so a board import is one bundle.
