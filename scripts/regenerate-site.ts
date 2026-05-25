/**
 * Regenerate a site's output files from its stored topology.
 * Usage: npx tsx scripts/regenerate-site.ts <site-id>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { parse as parseYaml } from "yaml";
import { parseTopology, topologyToManifestForController, type SiteTopology } from "../packages/core/src/index.js";
import { BoardDefSchema, type BoardDef } from "../electron/lib/board.js";
import { generateFirmware, generateSiteHA, generateDefaultSecrets, type GenerationMetadata } from "../electron/lib/generate.js";
import { validateAll } from "../electron/lib/validate.js";
import { reconstructTopology } from "../electron/lib/reconstruct-topology.js";
import type { SiteDashboardSystem } from "../electron/lib/generators/site-dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const siteId = process.argv[2];
if (!siteId) {
  console.error("Usage: npx tsx scripts/regenerate-site.ts <site-id>");
  process.exit(1);
}

const userBoardsDir = path.join(process.env.HOME!, ".config/majiflow-app/store/boards");
const defaultBoardsDir = path.join(projectRoot, "defaults/boards");

function resolveBoardDir(idOrModel: string): string {
  const userDir = path.join(userBoardsDir, idOrModel);
  if (fs.existsSync(userDir)) return userDir;

  if (fs.existsSync(userBoardsDir)) {
    for (const d of fs.readdirSync(userBoardsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const yamlPath = path.join(userBoardsDir, d.name, "board.yaml");
      if (!fs.existsSync(yamlPath)) continue;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      if (parsed.model === idOrModel) return path.join(userBoardsDir, d.name);
    }
  }

  const defaultDir = path.join(defaultBoardsDir, idOrModel);
  if (fs.existsSync(defaultDir)) return defaultDir;

  if (fs.existsSync(defaultBoardsDir)) {
    for (const d of fs.readdirSync(defaultBoardsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const yamlPath = path.join(defaultBoardsDir, d.name, "board.yaml");
      if (!fs.existsSync(yamlPath)) continue;
      const raw = fs.readFileSync(yamlPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown>;
      if (parsed.model === idOrModel) return path.join(defaultBoardsDir, d.name);
    }
  }

  throw new Error(`Board not found: ${idOrModel}`);
}

function loadBoard(idOrModel: string): { board: Record<string, unknown>; svg: string | null } {
  const dir = resolveBoardDir(idOrModel);
  const id = path.basename(dir);
  const yamlPath = path.join(dir, "board.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const board = parseYaml(raw) as Record<string, unknown>;
  board.id = id;
  const svgField = (board.svg as string) ?? "board.svg";
  const svgPath = path.join(dir, svgField);
  const svg = fs.existsSync(svgPath) ? fs.readFileSync(svgPath, "utf-8") : null;
  return { board, svg };
}

function buildSiteTopologyFromSystems(db: any, siteId: string): SiteTopology {
  const systems = db.exec(
    'SELECT id, friendly_name, board, directory, topology, device_name FROM systems WHERE site_id = ?',
    [siteId]
  );
  if (!systems.length || !systems[0].values.length) {
    throw new Error(`No systems found for site: ${siteId}`);
  }

  const controllers: Array<{ id: string; board: string; friendlyName?: string; directory?: string; network?: unknown; uart_buses?: unknown; io_providers?: unknown }> = [];
  const nodes: unknown[] = [];
  const pipes: Array<{ id: string; from: string; to: string }> = [];
  let route_overrides: Record<string, unknown> = {};
  let timing: unknown;
  const automations: unknown[] = [];

  for (const sys of systems[0].values) {
    const sysId = sys[0] as string;
    const sysFriendlyName = sys[1] as string;
    const sysBoard = sys[2] as string;
    const sysDirectory = sys[3] as string | null;
    const topo = JSON.parse(sys[4] as string) as Record<string, unknown>;

    controllers.push({
      id: sysId,
      board: sysBoard,
      friendlyName: sysFriendlyName,
      directory: sysDirectory ?? undefined,
      network: topo.network,
      uart_buses: topo.uart_buses,
      io_providers: topo.io_providers,
    });
    for (const n of (topo.nodes as Array<Record<string, unknown>> ?? [])) {
      nodes.push({ ...n, anchorId: sysId });
    }
    for (const p of (topo.pipes as Array<{ id: string; from: string; to: string }> ?? [])) {
      pipes.push(p);
    }
    route_overrides = { ...route_overrides, ...(topo.route_overrides as Record<string, unknown> ?? {}) };
    for (const a of (topo.automations as unknown[] ?? [])) {
      automations.push(a);
    }
    if (!timing && topo.timing) timing = topo.timing;
  }

  // Migrate legacy links into pipes
  const links = db.exec(
    'SELECT id, from_system, from_node, from_port, to_system, to_node, to_port FROM links WHERE site_id = ?',
    [siteId]
  );
  if (links.length) {
    for (const link of links[0].values) {
      pipes.push({
        id: link[0] as string,
        from: `${link[2]}:${link[3]}`,
        to: `${link[5]}:${link[6]}`,
      });
    }
  }

  return {
    schema: 16,
    controllers,
    nodes,
    pipes,
    route_overrides,
    timing: (timing as any) ?? { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
    automations,
    remoteImports: [],
  } as SiteTopology;
}

async function main() {
  const dbPath = path.join(process.env.HOME!, ".config/majiflow-app/store/generations.db");
  const dbData = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(dbData);

  // Load site metadata
  const siteRow = db.exec('SELECT id, friendly_name FROM sites WHERE id = ?', [siteId]);
  if (!siteRow.length || !siteRow[0].values.length) {
    console.error(`Site not found: ${siteId}`);
    process.exit(1);
  }
  const friendlyName = siteRow[0].values[0][1] as string;

  // Try to reconstruct from events first
  const eventsResult = db.exec('SELECT id, site_id, event_type, payload, timestamp FROM topology_events WHERE site_id = ? ORDER BY id', [siteId]);
  let fullTopology: SiteTopology;

  if (eventsResult.length && eventsResult[0].values.length) {
    const events = eventsResult[0].values.map(v => ({
      id: v[0] as number,
      siteId: v[1] as string,
      eventType: v[2] as string,
      payload: JSON.parse(v[3] as string),
      timestamp: v[4] as string,
    }));
    fullTopology = reconstructTopology(events, Infinity);
    console.log(`Reconstructed from events: schema=${fullTopology.schema}, controllers=${fullTopology.controllers.length}, nodes=${fullTopology.nodes.length}`);
  } else {
    fullTopology = buildSiteTopologyFromSystems(db, siteId);
    console.log(`Built from systems table: schema=${fullTopology.schema}, controllers=${fullTopology.controllers.length}, nodes=${fullTopology.nodes.length}`);
  }

  const outputDir = path.join(process.env.HOME!, ".majiflow/output");

  // Generate per-system firmware
  for (const ctrl of fullTopology.controllers) {
    const systemId = ctrl.id;
    console.log(`\nGenerating firmware for ${systemId}...`);

    const manifest = topologyToManifestForController(fullTopology, systemId);
    const boardData = loadBoard(ctrl.board);
    const board = BoardDefSchema.parse(boardData.board) as BoardDef;

    const validation = validateAll(fullTopology, manifest, board);
    if (!validation.ok) {
      const errors = validation.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
      console.error(`Validation errors:`);
      for (const err of errors) console.error(`  - ${err}`);
      continue;
    }

    const secrets = generateDefaultSecrets();

    const metadata: GenerationMetadata = {
      configSha: 'regenerated',
      version: 'regen',
      siteId,
      controllerId: systemId,
      schemaVersion: fullTopology.schema ?? 16,
      buildTimestamp: Math.floor(Date.now() / 1000),
      appVersion: '0.0.0',
    };

    let files;
    try {
      files = generateFirmware('esphome', manifest, board, siteId, secrets, metadata);
    } catch (err: any) {
      console.error(`Generate firmware failed: ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      continue;
    }

    for (const file of files) {
      const outPath = path.join(outputDir, file.relativePath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, file.content, 'utf-8');
    }

    console.log(`  Wrote ${files.length} files`);
  }

  // Generate site-level HA config
  console.log(`\nGenerating site HA config...`);

  const systems: SiteDashboardSystem[] = [];
  const manifests = new Map<string, import("../electron/lib/schema.js").Manifest>();

  for (const ctrl of fullTopology.controllers) {
    const manifest = topologyToManifestForController(fullTopology, ctrl.id);
    const boardData = loadBoard(ctrl.board);
    const board = BoardDefSchema.parse(boardData.board) as BoardDef;
    systems.push({ systemId: ctrl.id, friendlyName: ctrl.friendlyName ?? ctrl.id, manifest, board });
    manifests.set(ctrl.id, manifest);
  }

  const haFiles = generateSiteHA(siteId, friendlyName, systems, manifests);
  for (const file of haFiles) {
    const outPath = path.join(outputDir, file.relativePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, file.content, 'utf-8');
  }
  console.log(`  Wrote ${haFiles.length} HA files`);

  console.log(`\nDone. Output written to ${outputDir}`);
}

main().catch((e: any) => {
  console.log(String(e));
  if (e?.stack) console.log(e.stack);
  process.exit(1);
});
