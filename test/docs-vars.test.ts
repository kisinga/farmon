/**
 * Doc mechanism + drift guard tests.
 *
 *  - the per-scope variable vocabulary is non-empty and unique
 *  - resolvers cover exactly their vocabulary, with scalar values
 *  - slot extraction + unknown-slot detection (the name-drift guard)
 *  - fill + markdown render end to end
 *
 * Usage: npm run test:docs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseTopology, buildGraph, deriveRoutes, type SiteTopology,
  siteVars, boardVars, nodeVars, vocabFor,
  extractSlots, unknownSlots,
  parseFrontmatter, parseDocFile,
  type SiteVarCtx, type DocScope,
} from "@core";
import { fillVars, renderDoc } from "@core/docs";
import { loadBoard } from "./helpers";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function sampleTopology(): SiteTopology {
  return parseTopology({
    schema: 18,
    controllers: [{ id: "c1", friendlyName: "Controller One", board: "heltec-v3" }],
    nodes: [
      {
        kind: "tank", id: "src", name: "Source Tank",
        level_monitored: true, pressure_pin: "GPIO1", pressure_sensor_max_psi: 15,
        ports: [{ id: "inlet", label: "Inlet", direction: "inlet" }, { id: "outlet", label: "Outlet", direction: "outlet" }],
        position: { x: 0, y: 0 }, anchorId: "c1",
      },
      {
        kind: "valve", id: "v1", name: "Route Valve", open_pin: "GPIO2", close_pin: "GPIO3",
        ports: [{ id: "inlet", label: "Inlet", direction: "inlet" }, { id: "outlet", label: "Outlet", direction: "outlet" }],
        position: { x: 200, y: 0 }, anchorId: "c1",
      },
    ],
    pipes: [],
    route_overrides: {},
    automations: [],
    remoteImports: [],
    timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 2, update_interval: 5 },
  });
}

async function run() {
  const board = loadBoard(path.join(DEFAULTS, "boards/heltec-v3"));
  const topo = sampleTopology();
  const routeCount = deriveRoutes(buildGraph(topo.nodes, topo.pipes)).length;
  const siteCtx: SiteVarCtx = { siteName: "Demo Site", topo, routeCount };

  // --- vocabulary shape ---
  for (const scope of ["narrative", "board", "node"] as const) {
    const v = vocabFor(scope);
    assert(v.length > 0, `vocab(${scope}) non-empty`);
    assert(new Set(v).size === v.length, `vocab(${scope}) has no duplicate slots`);
  }

  // --- resolvers cover exactly their vocabulary, scalar values ---
  const site = siteVars(siteCtx);
  assert(
    JSON.stringify(Object.keys(site).sort()) === JSON.stringify([...vocabFor("narrative")].sort()),
    "siteVars keys == narrative vocab",
  );
  assert(Object.values(site).every(v => typeof v === "string" || typeof v === "number"),
    "siteVars values are all scalar");
  assert(site["flow_watchdog"] === 30 && site["valve_travel_time"] === 15,
    "siteVars pulls live timing", JSON.stringify(site));
  assert(site["tank_count"] === 1 && site["valve_count"] === 1 && site["controller_count"] === 1,
    "siteVars counts nodes/controllers", JSON.stringify(site));

  const boardScope = { ...siteVars(siteCtx), ...boardVars(board) };
  assert(
    JSON.stringify(Object.keys(boardScope).sort()) === JSON.stringify([...vocabFor("board")].sort()),
    "site+board keys == board vocab",
  );
  assert(boardScope["board_model"] === board.model && typeof boardScope["adc_pin_count"] === "number",
    "boardVars pulls board facts", JSON.stringify(boardVars(board)));

  const nodeScope = { ...siteVars(siteCtx), ...nodeVars({ kind: "valve", topo }) };
  assert(
    JSON.stringify(Object.keys(nodeScope).sort()) === JSON.stringify([...vocabFor("node")].sort()),
    "site+node keys == node vocab",
  );
  assert(nodeScope["node_kind"] === "valve" && nodeScope["node_kind_count"] === 1 && nodeScope["node_kind_label"] === "Valve",
    "nodeVars describes the kind", JSON.stringify(nodeVars({ kind: "valve", topo })));

  // --- slot extraction + drift detection ---
  assert(JSON.stringify(extractSlots("a {{x}} b {{ y }} c {{z.w}} {{x}}").sort()) === JSON.stringify(["x", "y", "z"]),
    "extractSlots: trims, dedups, roots nested paths");
  assert(unknownSlots("watchdog {{flow_watchdog}}s", "narrative").length === 0,
    "known slot passes the drift guard");
  assert(JSON.stringify(unknownSlots("{{bogus_slot}} {{flow_watchdog}}", "narrative")) === JSON.stringify(["bogus_slot"]),
    "unknown slot is flagged");
  assert(unknownSlots("{{board_model}}", "narrative").length === 1,
    "board slot is out-of-scope in a narrative doc");
  assert(unknownSlots("{{board_model}}", "board").length === 0,
    "board slot is in-scope in a board doc");

  // --- fill + markdown render ---
  assert(fillVars("Flow watchdog: {{flow_watchdog}}s", site) === "Flow watchdog: 30s",
    "fillVars substitutes a live value");
  assert(fillVars("Missing: {{nope}}.", site) === "Missing: .",
    "fillVars renders an unknown slot empty (no throw)");
  const html = await renderDoc("# {{site_name}}\n\nWatchdog **{{flow_watchdog}}s**.", site);
  assert(html.includes("<h1") && html.includes("Demo Site") && html.includes("<strong>30s</strong>"),
    "renderDoc fills then renders markdown→HTML", html);

  // --- frontmatter parser (the docs import path) ------------------------------
  {
    const sample = "---\nslug: op\ntitle: Operation\ncategory: narrative\norder: 10\n---\n\nBody {{site_name}}\n";
    const { fm, body } = parseFrontmatter(sample);
    assert(fm["slug"] === "op" && fm["order"] === "10", "parseFrontmatter reads scalar keys");
    assert(body === "Body {{site_name}}\n", "parseFrontmatter strips the block, keeps the body");
    assert(parseFrontmatter("# no frontmatter").fm["category"] === undefined, "parseFrontmatter: none → empty fm");

    const doc = parseDocFile("operation.md", sample);
    assert(doc?.slug === "op" && doc?.category === "narrative" && doc?.order === 10, "parseDocFile maps frontmatter → doc");
    assert(parseDocFile("readme.md", "no frontmatter here") === null, "parseDocFile: no category → null (skipped)");
    assert(parseDocFile("valve.md", "---\ntitle: Valve\ncategory: node\n---\nx")?.slug === "valve", "parseDocFile: slug falls back to filename");
  }

  // --- migrated content: every docs-content/*.md slot must be in scope --------
  const contentDir = path.resolve(DEFAULTS, "..", "docs-content");
  if (fs.existsSync(contentDir)) {
    for (const f of fs.readdirSync(contentDir).filter(n => n.endsWith(".md"))) {
      const doc = parseDocFile(f, fs.readFileSync(path.join(contentDir, f), "utf-8"));
      if (!doc) continue; // not a doc (e.g. README) — no frontmatter
      const scope: DocScope = doc.category === "node" ? "node" : "narrative";
      const bad = unknownSlots(doc.body, scope);
      assert(bad.length === 0, `docs-content/${f}: slots valid for ${scope} scope`, bad.join(", "));
    }
  }

  // --- board reference docs (in each board def): slots must be in 'board' scope -
  const boardsDir = path.join(DEFAULTS, "boards");
  if (fs.existsSync(boardsDir)) {
    for (const model of fs.readdirSync(boardsDir)) {
      const bj = path.join(boardsDir, model, "board.json");
      if (!fs.existsSync(bj)) continue;
      // Read raw — expansion boards aren't BoardDef-shaped; we only need `documentation`.
      const raw = JSON.parse(fs.readFileSync(bj, "utf-8"));
      const sections: Array<{ slug?: string; body?: string }> = raw.documentation ?? [];
      for (const sec of sections) {
        const bad = unknownSlots(sec.body ?? "", "board");
        assert(bad.length === 0, `boards/${model} doc "${sec.slug}": slots valid (board)`, bad.join(", "));
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
