import { ipcMain, BrowserWindow, dialog, shell } from "electron";
import * as fs from "node:fs";
import { BoardDefSchema, type BoardDef } from "./lib/board.js";
import { parseTopology } from "./lib/topology.js";
import { validateAll } from "./lib/validate.js";
import { generateEsphome, generateSiteHA, generateDefaultSecrets, type SecretsMap } from "./lib/generate.js";
import { generateSelfTest } from "./lib/self-test/index.js";
import { topologyToManifest } from "./lib/topology-to-manifest.js";
import * as store from "./store.js";
import * as db from "./db.js";
import { detectToolchain, refreshToolchain } from "./toolchain.js";
import { checkHealth, fixDeps } from "./health.js";
import { collectPins, reservedPins, computePinOverlays, slug } from '@far-mon/core';
import { generateSiteDocumentation, type PinTableRow } from './lib/generators/site-readme.js';
import * as esphome from "./esphome.js";
import { killProcess } from "./process-manager.js";
import { listSerialPorts } from "./discovery.js";
import { serialMonitor } from "./serial-monitor.js";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function winFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error("No window");
  return win;
}

/**
 * Pin sort: native GPIOs (numeric), then expander pins (prefix then number),
 * then provider channels (alphabetic). Keeps the doc table readable for wirers.
 */
function comparePinRows(a: PinTableRow, b: PinTableRow): number {
  const rank = (p: string): [number, string, number] => {
    const gpio = /^GPIO(\d+)$/.exec(p);
    if (gpio) return [0, '', parseInt(gpio[1], 10)];
    const exp = /^([A-Z]+)(\d+)$/.exec(p);
    if (exp) return [1, exp[1], parseInt(exp[2], 10)];
    return [2, p, 0];
  };
  const [ar, ap, an] = rank(a.pin);
  const [br, bp, bn] = rank(b.pin);
  return ar - br || ap.localeCompare(bp) || an - bn;
}

/** Parse topology and derive manifest (activeGraph filtering happens inside topologyToManifest). */
function resolveTopologyAndManifest(dataRaw: unknown) {
  const topology = parseTopology(dataRaw);
  const manifest = topologyToManifest(topology);
  return { topology, manifest };
}

/**
 * Reconstruct a full SystemTopology object from stored parts.
 * The DB stores topology as a JSON blob (nodes, pipes, etc.) separate from
 * controller-level fields (name, board, etc.). This merges them back.
 */
function reconstructTopology(
  systemId: string,
  friendlyName: string,
  board: string,
  directory: string | null,
  storedTopology: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema: store.SCHEMA_VERSION,
    device: {
      name: systemId,
      friendly_name: friendlyName,
      board,
      directory: directory ?? undefined,
      uart_buses: storedTopology.uart_buses,
      io_providers: storedTopology.io_providers,
      network: storedTopology.network as any,
    },
    nodes: storedTopology.nodes ?? [],
    pipes: storedTopology.pipes ?? [],
    route_overrides: storedTopology.route_overrides ?? {},
    timing: storedTopology.timing ?? {
      valve_travel_time: 2,
      flow_watchdog: 30,
      flow_confirm: 5,
      api_watchdog: 300,
      update_interval: 10,
    },
    automations: storedTopology.automations ?? [],
  };
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerIpcHandlers() {

  // =========================================================================
  // Sites
  // =========================================================================

  ipcMain.handle("site:list", async () => db.listSites());

  ipcMain.handle("site:load", async (_e, id: string) => {
    const payload = db.loadSiteFull(id);
    if (!payload) throw new Error(`Site not found: ${id}`);
    return payload;
  });

  ipcMain.handle("site:save", async (_e, payload: db.SiteSavePayload) => {
    db.saveSiteTransaction(payload);
    return { ok: true };
  });

  ipcMain.handle("site:create", async (_e, id: string, friendlyName: string) => {
    db.createSite(id, friendlyName);
    return { ok: true };
  });

  ipcMain.handle("site:delete", async (_e, id: string) => {
    db.deleteSite(id);
    return { ok: true };
  });

  ipcMain.handle("site:duplicate", async (_e, sourceId: string, newId: string, newFriendlyName: string) => {
    db.duplicateSite(sourceId, newId, newFriendlyName);
    return { ok: true, id: newId };
  });

  ipcMain.handle("site:rename", async (_e, id: string, friendlyName: string) => {
    db.renameSite(id, friendlyName);
    return { ok: true };
  });

  ipcMain.handle("site:export", async (event, siteId: string) => {
    const payload = db.loadSiteFull(siteId);
    if (!payload) throw new Error(`Site not found: ${siteId}`);

    // Include HA files in export
    const haFiles = db.listHaFiles(siteId).map(filename => ({
      filename,
      content: db.loadHaFile(siteId, filename) ?? '',
    }));

    const exportData = { exportVersion: 1, ...payload, haFiles };
    const json = JSON.stringify(exportData, null, 2);

    const win = winFromEvent(event);
    const result = await dialog.showSaveDialog(win, {
      title: "Export Site",
      defaultPath: `${siteId}.majiflow.json`,
      filters: [{ name: "MajiFlow Site", extensions: ["majiflow.json", "json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };

    fs.writeFileSync(result.filePath, json, "utf-8");
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("site:import", async (event) => {
    const win = winFromEvent(event);
    const result = await dialog.showOpenDialog(win, {
      title: "Import Site",
      filters: [{ name: "MajiFlow Site", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };

    const raw = fs.readFileSync(result.filePaths[0], "utf-8");
    const data = JSON.parse(raw) as db.SiteFullPayload & {
      exportVersion?: number;
      haFiles?: Array<{ filename: string; content: string }>;
    };

    const exportVersion = data.exportVersion ?? 0;
    if (exportVersion > 1) {
      throw new Error(`This file was exported with a newer format (v${exportVersion}). Update the app to import it.`);
    }

    if (!data.site?.id || !data.site?.friendlyName) {
      throw new Error("Invalid site file: missing site.id or site.friendlyName");
    }

    // Avoid ID collision — append suffix if site already exists
    let siteId = data.site.id;
    while (db.loadSiteFull(siteId)) {
      siteId = siteId + '-imported';
    }
    data.site.id = siteId;

    // Backfill deviceName for legacy exports (v0) that don't have it
    const systems = data.systems.map(s => ({
      ...s,
      deviceName: (s as any).deviceName || s.id,
    }));

    db.saveSiteTransaction({
      site: data.site,
      systems,
      links: data.links,
    });

    // Import HA files
    if (data.haFiles) {
      for (const hf of data.haFiles) {
        db.saveHaFile(siteId, hf.filename, hf.content);
      }
    }

    return { ok: true, siteId };
  });

  // =========================================================================
  // Systems (within a site)
  // =========================================================================

  ipcMain.handle("system:list", async (_e, siteId: string) => db.listSystems(siteId));

  /**
   * Add a system from a template. Loads template YAML, remaps any conflicting
   * node IDs, inserts into DB, returns the full system payload.
   */
  ipcMain.handle(
    "system:add-from-template",
    async (_e, siteId: string, templateName: string) => {
      const templateData = store.loadTemplate(templateName);
      const device = templateData.device as Record<string, unknown> | undefined;
      const nodes = Array.isArray(templateData.nodes)
        ? (templateData.nodes as Array<Record<string, unknown>>)
        : [];

      // Generate system ID (unique within site)
      const existingSystems = db.listSystems(siteId);
      const existingIds = new Set(existingSystems.map(s => s.id));
      let systemId = templateName;
      if (existingIds.has(systemId)) {
        let i = 2;
        while (existingIds.has(`${templateName}${i}`)) i++;
        systemId = `${templateName}${i}`;
      }

      // Remap any node IDs that conflict with existing ones in the site
      const existingNodeIds = new Set(db.getAllNodeIds(siteId));
      const kindMax = new Map<string, number>();

      // Parse a node ID into (kind, number). Bare IDs like "pump" → ("pump", 1).
      function parseNodeId(id: string): { kind: string; num: number } | null {
        const numbered = id.match(/^([a-z_]+?)(\d+)$/);
        if (numbered) return { kind: numbered[1], num: parseInt(numbered[2]) };
        if (/^[a-z_]+$/.test(id)) return { kind: id, num: 1 };
        return null;
      }

      // Compute max suffix per kind across ALL IDs (existing + template)
      for (const id of [...existingNodeIds, ...nodes.map(n => n.id as string)]) {
        const parsed = id ? parseNodeId(id) : null;
        if (parsed) {
          kindMax.set(parsed.kind, Math.max(kindMax.get(parsed.kind) ?? 0, parsed.num));
        }
      }

      const remap = new Map<string, string>();
      for (const node of nodes) {
        const oldId = node.id as string;
        if (!oldId || !existingNodeIds.has(oldId)) continue;
        const parsed = parseNodeId(oldId);
        if (parsed) {
          const next = (kindMax.get(parsed.kind) ?? 0) + 1;
          kindMax.set(parsed.kind, next);
          remap.set(oldId, `${parsed.kind}${next}`);
        }
      }

      if (remap.size > 0) {
        // Apply remap to nodes
        for (const node of nodes) {
          const newId = remap.get(node.id as string);
          if (newId) node.id = newId;
        }

        // Apply remap to pipes
        const pipes = Array.isArray(templateData.pipes)
          ? (templateData.pipes as Array<Record<string, unknown>>)
          : [];
        for (const pipe of pipes) {
          pipe.from = remapPortRef(pipe.from as string, remap);
          pipe.to = remapPortRef(pipe.to as string, remap);
        }

        // Apply remap to route_overrides keys
        const overrides = templateData.route_overrides as Record<string, unknown> | undefined;
        if (overrides) {
          const newOverrides: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(overrides)) {
            newOverrides[remapRouteKey(key, remap)] = value;
          }
          templateData.route_overrides = newOverrides;
        }

        // Apply remap to automations
        const automations = Array.isArray(templateData.automations)
          ? (templateData.automations as Array<Record<string, unknown>>)
          : [];
        for (const auto of automations) {
          auto.route = remapRouteKey(auto.route as string, remap);
          const trigger = auto.trigger as Record<string, unknown> | undefined;
          if (trigger?.node && remap.has(trigger.node as string)) {
            trigger.node = remap.get(trigger.node as string)!;
          }
        }
      }

      // Build StoredTopology
      const topology = {
        nodes: templateData.nodes ?? [],
        pipes: templateData.pipes ?? [],
        route_overrides: templateData.route_overrides ?? {},
        timing: templateData.timing ?? {
          valve_travel_time: 2,
          flow_watchdog: 30,
          flow_confirm: 5,
          api_watchdog: 300,
          update_interval: 10,
        },
        automations: templateData.automations ?? [],
        uart_buses: (device as Record<string, unknown>)?.uart_buses,
        io_providers: (device as Record<string, unknown>)?.io_providers,
      };

      const system = {
        id: systemId,
        friendlyName: (device?.friendly_name as string) ?? templateName,
        board: (device?.board as string) ?? "unknown",
        directory: (device?.directory as string) ?? null,
        topology,
        deviceName: slug((device?.friendly_name as string) ?? templateName),
      };

      db.insertSystem(siteId, system);

      return system;
    },
  );

  ipcMain.handle("system:delete", async (_e, siteId: string, systemId: string) => {
    db.deleteSystem(siteId, systemId);
    return { ok: true };
  });

  // =========================================================================
  // Templates
  // =========================================================================

  ipcMain.handle("template:list", async () => store.listTemplates());

  ipcMain.handle("template:load", async (_e, name: string) => store.loadTemplate(name));

  // =========================================================================
  // Boards
  // =========================================================================

  ipcMain.handle("board:list", async () => store.listBoards());

  ipcMain.handle("board:load", async (_e, model: string) =>
    store.loadBoard(model)
  );

  ipcMain.handle("board:import", async (_e, dirPath: string) =>
    store.importBoard(dirPath)
  );

  // =========================================================================
  // Codegen
  // =========================================================================

  ipcMain.handle(
    "codegen:derive-routes",
    async (_e, dataRaw: unknown) => {
      const { manifest } = resolveTopologyAndManifest(dataRaw);
      return manifest.routes.map(r => ({ key: r.key, name: r.name }));
    }
  );

  ipcMain.handle(
    "codegen:validate",
    async (_e, dataRaw: unknown, boardRaw: unknown) => {
      const board = BoardDefSchema.parse(boardRaw) as BoardDef;
      const { topology, manifest } = resolveTopologyAndManifest(dataRaw);
      return validateAll(topology, manifest, board);
    }
  );

  ipcMain.handle(
    "codegen:generate",
    async (_e, siteId: string, systemId: string, dataRaw: unknown, boardRaw: unknown) => {
      const board = BoardDefSchema.parse(boardRaw) as BoardDef;
      const { topology, manifest } = resolveTopologyAndManifest(dataRaw);
      const validation = validateAll(topology, manifest, board);
      if (!validation.ok) {
        const errors = validation.diagnostics
          .filter(d => d.severity === 'error')
          .map(d => d.message);
        throw new Error(errors.join('\n'));
      }

      // Load secrets from DB, falling back to defaults
      const savedSecrets = db.getSecrets(siteId, systemId);
      const secrets: SecretsMap = {
        ...generateDefaultSecrets(),
        ...savedSecrets,
      } as SecretsMap;
      const files = generateEsphome(manifest, board, secrets);

      const gen = db.createGeneration(siteId, systemId, topology, board, 'esphome', { ...secrets });
      const latestMeta = gen ? null : db.listGenerations(siteId, systemId, 'esphome')[0] ?? null;
      const version = gen?.version ?? latestMeta?.version ?? '';
      const deviceDir = manifest.device.directory ?? manifest.device.name;

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      if (gen) {
        db.finalizeGeneration(gen.id, files.length);
        db.pruneGenerations(siteId, systemId, 10, 'esphome');
      }

      return {
        outputDir,
        deviceDir,
        generationId: gen?.id ?? latestMeta?.id ?? 0,
        version,
        files: files.map((f) => ({
          path: f.relativePath,
          description: f.description,
          lines: f.content.split("\n").length,
        })),
      };
    }
  );

  // =========================================================================
  // Site-level HA config (dashboard + automations)
  // =========================================================================

  ipcMain.handle(
    "codegen:generate-ha",
    async (_e, siteId: string) => {
      const site = db.loadSiteFull(siteId);
      if (!site) throw new Error(`Site not found: ${siteId}`);

      const systems: Array<{ systemId: string; friendlyName: string; manifest: import("./lib/schema.js").Manifest }> = [];
      const manifests = new Map<string, import("./lib/schema.js").Manifest>();

      for (const sp of site.systems) {
        const fullTopology = reconstructTopology(
          sp.deviceName || sp.id, sp.friendlyName, sp.board, sp.directory,
          sp.topology as unknown as Record<string, unknown>,
        );
        const { manifest } = resolveTopologyAndManifest(fullTopology);
        systems.push({ systemId: sp.id, friendlyName: sp.friendlyName, manifest });
        manifests.set(sp.id, manifest);
      }

      const files = generateSiteHA(site.site.friendlyName, systems, manifests);

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      return {
        outputDir,
        files: files.map((f) => ({
          path: f.relativePath,
          description: f.description,
          lines: f.content.split("\n").length,
        })),
      };
    }
  );

  // =========================================================================
  // Self-test firmware generation
  // =========================================================================

  ipcMain.handle(
    "codegen:generate-selftest",
    async (_e, boardModel: string, secretsRaw: Record<string, string>) => {
      const boardData = store.loadBoard(boardModel);
      const board = BoardDefSchema.parse(boardData.board) as BoardDef;
      const { wifi_ssid, wifi_password, fallback_password, api_key, ota_password } = secretsRaw;
      if (!api_key || !ota_password || !fallback_password) {
        throw new Error('Missing required secrets (api_key, ota_password, fallback_password)');
      }
      const secrets: SecretsMap = { wifi_ssid: wifi_ssid ?? '', wifi_password: wifi_password ?? '', fallback_password, api_key, ota_password };
      const files = generateSelfTest(board, secrets);
      const model = board.model.replace('_', '-');
      const deviceDir = `selftest-${model}`;

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      return {
        outputDir,
        deviceDir,
        files: files.map((f) => ({
          path: f.relativePath,
          description: f.description,
          lines: f.content.split("\n").length,
        })),
      };
    }
  );

  // =========================================================================
  // Site-level documentation
  // =========================================================================

  ipcMain.handle(
    "codegen:generate-site-docs",
    async (
      _e,
      siteId: string,
      compositeSvg: string,
      perSystemSvgs: Record<string, string>,
      systemsRaw: Array<{ systemId: string; friendlyName: string; board: string; deviceName: string; topology: unknown }>,
      linksRaw: Array<{ id: string; fromSystem: string; fromNode: string; fromPort: string; toSystem: string; toNode: string; toPort: string; label?: string | null }>,
      routesRaw: unknown[],
    ) => {
      // Derive manifests and board data for each system
      const systems = systemsRaw.map(s => {
        const { topology, manifest } = resolveTopologyAndManifest(s.topology);
        const usages = collectPins(topology.nodes);
        // Load board SVG and compute pin overlays for per-device sections
        let boardSvg: string | undefined;
        let pinOverlays: ReturnType<typeof computePinOverlays> | undefined;
        let pinTable: PinTableRow[] | undefined;
        try {
          const boardData = store.loadBoard(s.board);
          if (boardData?.svg && boardData?.board) {
            boardSvg = boardData.svg;
            const board = boardData.board as unknown as BoardDef;
            const usedPins = new Map(usages.map(u => [u.pin, u.owner]));
            const reserved = reservedPins(board);
            pinOverlays = computePinOverlays(board, usedPins, reserved);
            // Build installation-facing pin connection table by joining usages
            // against the board's pin defs to surface silkscreen + capability info.
            const byGpio = new Map(board.pins.map(p => [p.gpio, p]));
            pinTable = usages
              .map((u): PinTableRow => {
                const def = byGpio.get(u.pin);
                return {
                  connector: def?.connector,
                  pin: u.pin,
                  entity: u.nodeName,
                  typeLabel: u.typeLabel,
                  fieldLabel: u.fieldLabel,
                  caps: def?.caps?.join(', '),
                  polarity: u.polarity,
                };
              })
              .sort(comparePinRows);
          }
        } catch { /* board not available, skip pinout */ }
        if (!pinTable && usages.length) {
          // Board metadata unavailable — still surface the table without connector/caps.
          pinTable = usages
            .map((u): PinTableRow => ({
              pin: u.pin,
              entity: u.nodeName,
              typeLabel: u.typeLabel,
              fieldLabel: u.fieldLabel,
              polarity: u.polarity,
            }))
            .sort(comparePinRows);
        }
        return {
          systemId: s.systemId,
          friendlyName: s.friendlyName,
          board: s.board,
          deviceName: s.deviceName,
          manifest,
          boardSvg,
          pinOverlays,
          pinTable,
          topologySvg: perSystemSvgs[s.systemId] ?? '',
        };
      });

      const html = generateSiteDocumentation(
        db.loadSiteFull(siteId)?.site.friendlyName ?? siteId,
        systems,
        linksRaw,
        compositeSvg,
        routesRaw as any[],
      );

      // Write to output dir
      const outputDir = store.getOutputDir();
      const filePath = `site-documentation.html`;
      const fullPath = require('node:path').join(outputDir, filePath);
      require('node:fs').mkdirSync(outputDir, { recursive: true });
      require('node:fs').writeFileSync(fullPath, html, 'utf-8');

      return { html, outputPath: fullPath };
    },
  );

  // =========================================================================
  // SCADA artifacts (SVG + meta sidecar) — consumed by farm-scada-card on HA
  // =========================================================================

  ipcMain.handle(
    "codegen:write-scada-artifacts",
    async (
      _e,
      siteId: string,
      artifacts: Array<{ name: string; svg: string; meta: unknown }>,
    ) => {
      if (!db.loadSiteFull(siteId)) throw new Error(`Site not found: ${siteId}`);
      const outputDir = store.getOutputDir();
      const files: Array<{ relativePath: string; content: string }> = [];
      for (const a of artifacts) {
        const base = `config/homeassistant/www/farm/${a.name}`;
        files.push({ relativePath: `${base}.svg`, content: a.svg });
        files.push({ relativePath: `${base}.meta.json`, content: JSON.stringify(a.meta, null, 2) });
      }
      store.writeOutput(files, outputDir);
      return {
        outputDir,
        files: files.map(f => ({ path: f.relativePath, bytes: f.content.length })),
      };
    },
  );

  // =========================================================================
  // HA config files (per-site, DB-backed)
  // =========================================================================

  ipcMain.handle("site:ha-list", async (_e, siteId: string) =>
    db.listHaFiles(siteId)
  );

  ipcMain.handle("site:ha-load", async (_e, siteId: string, filename: string) => {
    const content = db.loadHaFile(siteId, filename);
    if (content === null) throw new Error(`HA file not found: ${siteId}/${filename}`);
    return content;
  });

  ipcMain.handle(
    "site:ha-save",
    async (_e, siteId: string, filename: string, content: string) => {
      db.saveHaFile(siteId, filename, content);
      return { ok: true };
    }
  );

  // =========================================================================
  // Toolchain
  // =========================================================================

  ipcMain.handle("toolchain:status", async () => detectToolchain());
  ipcMain.handle("toolchain:refresh", async () => refreshToolchain());

  // =========================================================================
  // ESPHome operations
  // =========================================================================

  ipcMain.handle("esphome:compile", async (event, configName: string) => {
    const { result } = esphome.compile(winFromEvent(event), configName);
    return result;
  });

  ipcMain.handle(
    "esphome:flash",
    async (event, configName: string, device?: string) => {
      const { result } = esphome.flash(winFromEvent(event), configName, device);
      return result;
    }
  );

  ipcMain.handle(
    "esphome:logs",
    async (event, configName: string, device?: string) => {
      const { result } = esphome.logs(winFromEvent(event), configName, device);
      return result;
    }
  );

  ipcMain.handle("esphome:cancel", async (_e, processId: string) => ({
    cancelled: killProcess(processId),
  }));

  // =========================================================================
  // Serial monitor
  // =========================================================================

  ipcMain.handle(
    "serial:monitor",
    async (event, port: string, baudRate: number) => {
      const { handle } = serialMonitor(winFromEvent(event), port, baudRate);
      return handle;
    }
  );

  ipcMain.handle("serial:cancel", async (_e, processId: string) => ({
    cancelled: killProcess(processId),
  }));

  // =========================================================================
  // Discovery
  // =========================================================================

  ipcMain.handle("device:list-serial", async () => listSerialPorts());

  // =========================================================================
  // Health
  // =========================================================================

  ipcMain.handle("health:check", async () => checkHealth());
  ipcMain.handle("health:fix", async () => fixDeps());

  // =========================================================================
  // File dialogs
  // =========================================================================

  ipcMain.handle(
    "dialog:open-file",
    async (event, options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
      const win = winFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: options.title,
        filters: options.filters,
        properties: ["openFile"],
      });
      return result.canceled ? null : result.filePaths[0];
    }
  );

  ipcMain.handle(
    "dialog:open-directory",
    async (event, options: { title?: string }) => {
      const win = winFromEvent(event);
      const result = await dialog.showOpenDialog(win, {
        title: options.title,
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    }
  );

  ipcMain.handle(
    "dialog:save-file",
    async (event, options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
      const win = winFromEvent(event);
      const result = await dialog.showSaveDialog(win, {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return result.canceled ? null : result.filePath;
    }
  );

  // =========================================================================
  // Shell
  // =========================================================================

  ipcMain.handle("shell:open-path", async (_e, fullPath: string) =>
    shell.openPath(fullPath)
  );

  ipcMain.handle("shell:show-item-in-folder", async (_e, fullPath: string) => {
    shell.showItemInFolder(fullPath);
    return { ok: true };
  });

  // =========================================================================
  // Store info
  // =========================================================================

  ipcMain.handle("store:path", async () => store.getStorePath());
  ipcMain.handle("store:output-dir", async () => store.getOutputDir());
  ipcMain.handle("store:seed-changes", async () => store.getSeedChanges());
  ipcMain.handle("store:apply-seed", async (_e, id?: string) => {
    store.applySeedChanges(id);
    return { ok: true };
  });
  ipcMain.handle("store:dismiss-seed", async (_e, id: string) => {
    store.dismissSeedChange(id);
    return { ok: true };
  });

  // --- Legacy import ---
  ipcMain.handle("legacy:has-data", async () => {
    // Only show if legacy YAML exists AND DB has no sites yet (not already imported)
    if (db.listSites().length > 0) return false;
    return store.hasLegacyData();
  });

  ipcMain.handle("legacy:scan", async () => store.scanLegacyData());

  ipcMain.handle("legacy:import", async (_e, sites: store.LegacyImportResult['sites']) => {
    let imported = 0;
    for (const site of sites) {
      // Skip if site ID already exists
      const existing = db.loadSiteFull(site.id);
      if (existing) continue;

      db.saveSiteTransaction({
        site: { id: site.id, friendlyName: site.friendlyName },
        systems: site.systems.map(s => ({
          id: s.id,
          friendlyName: s.friendlyName,
          board: s.board,
          directory: s.directory,
          topology: s.topology,
          deviceName: s.id,
        })),
        links: site.links,
      });

      // Import HA files
      for (const hf of site.haFiles) {
        db.saveHaFile(site.id, hf.filename, hf.content);
      }
      imported++;
    }
    return { imported };
  });

  // =========================================================================
  // Generation history
  // =========================================================================

  ipcMain.handle("generation:list", async (_e, siteId: string, systemId: string, genType?: db.GenerationType) =>
    db.listGenerations(siteId, systemId, genType)
  );

  ipcMain.handle("generation:load", async (_e, id: number) =>
    db.loadGeneration(id)
  );

  ipcMain.handle("generation:find", async (_e, version: string) =>
    db.loadGenerationByVersion(version)
  );

  ipcMain.handle("generation:latest", async (_e, siteId: string, systemId: string, genType?: db.GenerationType) => {
    const all = db.listGenerations(siteId, systemId, genType);
    return all[0] ?? null;
  });

  // =========================================================================
  // System secrets
  // =========================================================================

  ipcMain.handle("secrets:get", async (_e, siteId: string, systemId: string) =>
    db.getSecrets(siteId, systemId)
  );

  ipcMain.handle("secrets:set", async (_e, siteId: string, systemId: string, secrets: Record<string, string>) => {
    db.setSecrets(siteId, systemId, secrets);
  });
}

// ---------------------------------------------------------------------------
// Remap helpers (used during template instantiation)
// ---------------------------------------------------------------------------

function remapPortRef(ref: string, remap: Map<string, string>): string {
  const [nodeId, portId] = ref.split(':');
  const newNodeId = remap.get(nodeId) ?? nodeId;
  return `${newNodeId}:${portId}`;
}

function remapRouteKey(key: string, remap: Map<string, string>): string {
  return key.split('>').map(id => remap.get(id) ?? id).join('>');
}
