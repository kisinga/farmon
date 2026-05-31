import { ipcMain, BrowserWindow, dialog, shell, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { BoardDefSchema, type BoardDef } from "./lib/board.js";
import { parseTopology, type SiteTopology } from "./lib/topology.js";
import { validateAll } from "./lib/validate.js";
import { generateFirmware, generateSiteHA, generateDefaultSecrets, type SecretsMap, type GenerationMetadata } from "./lib/generate.js";

import { generateSelfTest } from "./lib/self-test/index.js";
import { topologyToManifestForController } from "./lib/topology-to-manifest.js";
import type { Manifest } from "./lib/schema.js";
import * as store from "./store.js";
import * as db from "./db.js";
import { detectToolchain, refreshToolchain } from "./toolchain.js";
import { checkHealth, fixDeps } from "./health.js";
import { collectPins, reservedPins, computePinOverlays, slug, boardSupportedTransports, effectiveTransport, NODE_REGISTRY, deriveHaEntityId, buildGraph, activeGraph, deriveRoutes, type Route, COMPONENT_REGISTRY } from '@far-mon/core';

import { generateSiteDocumentation, type PinTableRow } from './lib/generators/site-readme.js';
import * as esphome from "./esphome.js";
import { killProcess } from "./process-manager.js";
import { listSerialPorts } from "./discovery.js";
import { serialMonitor } from "./serial-monitor.js";
import { checkSiteDrift, checkHaConnection, type HaConnection } from "./drift-detector.js";
import {
  buildDeploymentPlan,
  executeDeployment,
  rollbackDeployment,
  type DeploymentPlan,
} from "./deployment-coordinator.js";
import { diffTopology } from "./lib/topology-diff.js";
import * as SiteRepository from "./lib/site-repository.js";


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

/**
 * Build a manifest for a specific controller from a SiteTopology.
 * Thin wrapper around topologyToManifestForController.
 */
function buildManifest(topology: SiteTopology, controllerId: string): Manifest {
  return topologyToManifestForController(topology, controllerId);
}

/**
 * Convert legacy multi-system export into a flat SiteTopology (schema v16).
 * Used for file import and legacy YAML migration only.
 */
function legacySystemsToSiteTopology(
  systems: Array<{
    id: string;
    friendlyName: string;
    board: string;
    directory: string | null;
    topology: Record<string, unknown>;
    deviceName: string;
  }>,
  links: Array<{
    id: string;
    fromSystem: string; fromNode: string; fromPort: string;
    toSystem: string; toNode: string; toPort: string;
    label?: string | null;
  }>,
): SiteTopology {
  const controllers: Array<{ id: string; board: string; friendlyName?: string; directory?: string; network?: unknown; uart_buses?: unknown; io_providers?: unknown }> = [];
  const nodes: unknown[] = [];
  const pipes: Array<{ id: string; from: string; to: string }> = [];
  let route_overrides: Record<string, unknown> = {};
  let timing: unknown;
  const automations: unknown[] = [];

  for (const sys of systems) {
    const topo = sys.topology;
    controllers.push({
      id: sys.id,
      board: sys.board,
      friendlyName: sys.friendlyName,
      directory: sys.directory ?? undefined,
      network: topo.network,
      uart_buses: topo.uart_buses,
      io_providers: topo.io_providers,
    });
    for (const n of (topo.nodes as Array<Record<string, unknown>> ?? [])) {
      nodes.push({ ...n, anchorId: sys.id });
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

  // Convert legacy inter-system links to pipes
  for (const link of links) {
    pipes.push({
      id: link.id,
      from: `${link.fromNode}:${link.fromPort}`,
      to: `${link.toNode}:${link.toPort}`,
    });
  }

  return parseTopology({
    schema: store.SCHEMA_VERSION,
    controllers,
    nodes,
    pipes,
    route_overrides,
    timing: timing ?? { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
    automations,
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerIpcHandlers() {

  // =========================================================================
  // Sites
  // =========================================================================

  ipcMain.handle("site:list", async () => SiteRepository.list());

  ipcMain.handle("site:load", async (_e, id: string) => {
    const payload = SiteRepository.loadFull(id);
    if (!payload) throw new Error(`Site not found: ${id}`);
    return payload;
  });

  ipcMain.handle("site:save", async (_e, payload: {
    site: { id: string; friendlyName: string };
    topology: unknown;
  }) => {
    const topology = parseTopology(payload.topology as Record<string, unknown>);

    // Update friendly name if it changed
    const existing = SiteRepository.loadFull(payload.site.id);
    if (existing && existing.site.friendlyName !== payload.site.friendlyName) {
      SiteRepository.rename(payload.site.id, payload.site.friendlyName);
    }

    // Sanitize: strip automations with empty routes so they don't pollute the manifest
    topology.automations = topology.automations.filter(
      (a) => a.route && a.route.trim() !== '',
    );

    const events = SiteRepository.save(payload.site.id, topology);
    console.log(`[site:save] ${payload.site.id}: generated ${events.length} events`);

    // Background: auto-backup to Google Drive if configured
    const refreshToken = db.getAppSetting("gdrive_refresh_token");
    if (refreshToken) {
      (async () => {
        try {
          const { refreshAccessToken } = await import("./lib/backup/oauth.js");
          const { ensureBackupFolder, uploadFile } = await import("./lib/backup/google-drive.js");
          const tokens = await refreshAccessToken(refreshToken);
          const folderId = await ensureBackupFolder(tokens.access_token);
          const full = SiteRepository.loadFull(payload.site.id);
          const json = JSON.stringify(full, null, 2);
          const fileName = `site-${payload.site.id}-${Date.now()}.json`;
          await uploadFile(tokens.access_token, folderId, fileName, "application/json", Buffer.from(json));
          console.log(`[backup] uploaded ${fileName}`);
        } catch (err) {
          console.error("[backup] auto-backup failed:", err);
        }
      })();
    }

    return { ok: true, events: events.length };
  });

  ipcMain.handle("site:create", async (_e, id: string, friendlyName: string) => {
    SiteRepository.create(id, friendlyName);
    return { ok: true };
  });

  ipcMain.handle("site:delete", async (_e, id: string) => {
    SiteRepository.deleteSite(id);
    return { ok: true };
  });

  ipcMain.handle("site:duplicate", async (_e, sourceId: string, newId: string, newFriendlyName: string) => {
    SiteRepository.duplicate(sourceId, newId, newFriendlyName);
    return { ok: true, id: newId };
  });

  ipcMain.handle("site:rename", async (_e, id: string, friendlyName: string) => {
    SiteRepository.rename(id, friendlyName);
    return { ok: true };
  });

  ipcMain.handle("site:export", async (event, siteId: string) => {
    const payload = SiteRepository.loadFull(siteId);
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
    const data = JSON.parse(raw) as {
      site: { id: string; friendlyName: string };
      systems?: Array<{
        id: string; friendlyName: string; board: string;
        directory: string | null; topology: Record<string, unknown>;
        deviceName?: string;
      }>;
      topology?: Record<string, unknown>;
      links?: Array<{
        id: string; fromSystem: string; fromNode: string; fromPort: string;
        toSystem: string; toNode: string; toPort: string;
        label?: string | null;
      }>;
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
    while (SiteRepository.loadFull(siteId)) {
      siteId = siteId + '-imported';
    }
    data.site.id = siteId;

    let topology: SiteTopology;
    if (data.topology) {
      // New flat export format
      topology = parseTopology(data.topology);
    } else if (data.systems) {
      // Legacy multi-system export — convert to flat SiteTopology
      const systems = data.systems.map(s => ({
        ...s,
        deviceName: s.deviceName || s.id,
      }));
      topology = legacySystemsToSiteTopology(systems, data.links ?? []);
    } else {
      throw new Error("Invalid site file: missing topology or systems");
    }

    SiteRepository.create(data.site.id, data.site.friendlyName);
    SiteRepository.save(data.site.id, topology);

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

  ipcMain.handle("system:list", async (_e, siteId: string) => SiteRepository.load(siteId).controllers);

  /**
   * Add a system from a template. Loads template YAML, remaps any conflicting
   * node IDs, inserts into DB, returns the full system payload.
   */
  ipcMain.handle(
    "system:add-from-template",
    async (_e, siteId: string, templateName: string, friendlyName?: string) => {
      const templateData = store.loadTemplate(templateName);
      const device = templateData.device as Record<string, unknown> | undefined;
      const nodes = Array.isArray(templateData.nodes)
        ? (templateData.nodes as Array<Record<string, unknown>>)
        : [];

      // Generate system ID (unique within site)
      const existingSystems = SiteRepository.load(siteId).controllers;
      const existingIds = new Set(existingSystems.map(s => s.id));
      const baseName = friendlyName ?? templateName;
      let systemId = slug(baseName);
      if (existingIds.has(systemId)) {
        let i = 2;
        while (existingIds.has(`${systemId}${i}`)) i++;
        systemId = `${systemId}${i}`;
      }

      // Remap any node IDs that conflict with existing ones in the site
      const existingNodeIds = new Set(SiteRepository.load(siteId).nodes.map(n => n.id));
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
          flow_threshold: 0.5,
          api_watchdog: 300,
          update_interval: 10,
        },
        automations: templateData.automations ?? [],
        uart_buses: (device as Record<string, unknown>)?.uart_buses,
        io_providers: (device as Record<string, unknown>)?.io_providers,
      };

      const systemFriendlyName = friendlyName ?? (device?.friendly_name as string) ?? templateName;
      const system = {
        id: systemId,
        friendlyName: systemFriendlyName,
        board: (device?.board as string) ?? "unknown",
        directory: (device?.directory as string) ?? null,
        topology,
        deviceName: slug(systemFriendlyName),
      };

      SiteRepository.addController(siteId, {
        id: system.id,
        friendlyName: system.friendlyName,
        board: system.board,
        directory: system.directory ?? undefined,
        network: (system.topology as Record<string, unknown>).network as import('@far-mon/core').NetworkConfig | undefined,
        uart_buses: (system.topology as Record<string, unknown>).uart_buses as import('@far-mon/core').UartBus[] | undefined,
        io_providers: (system.topology as Record<string, unknown>).io_providers as import('@far-mon/core').IoProviderDef[] | undefined,
      }, {
        nodes: (system.topology as Record<string, unknown>).nodes as import('@far-mon/core').TopologyNode[] | undefined,
        pipes: (system.topology as Record<string, unknown>).pipes as import('@far-mon/core').PipeSegment[] | undefined,
        route_overrides: (system.topology as Record<string, unknown>).route_overrides as Record<string, import('@far-mon/core').RouteOverride> | undefined,
        timing: (system.topology as Record<string, unknown>).timing as Partial<import('@far-mon/core').SiteTopology['timing']> | undefined,
        automations: (system.topology as Record<string, unknown>).automations as import('@far-mon/core').Automation[] | undefined,
      });

      // Seed default secrets so generation doesn't fail on missing API/OTA keys
      db.setSecrets(siteId, systemId, generateDefaultSecrets() as unknown as Record<string, string>);

      return {
        id: systemId,
        board: system.board,
        friendlyName: system.friendlyName,
        directory: system.directory ?? undefined,
        network: device?.network,
        uart_buses: (device as Record<string, unknown>)?.uart_buses,
        io_providers: (device as Record<string, unknown>)?.io_providers,
      };
    },
  );

  /**
   * Create a blank controller with no nodes.
   */
  ipcMain.handle(
    "system:create-blank",
    async (_e, siteId: string, friendlyName: string, board: string) => {
      const existingSystems = SiteRepository.load(siteId).controllers;
      const existingIds = new Set(existingSystems.map(s => s.id));

      let systemId = slug(friendlyName);
      if (existingIds.has(systemId)) {
        let i = 2;
        while (existingIds.has(`${systemId}${i}`)) i++;
        systemId = `${systemId}${i}`;
      }

      const topology = {
        nodes: [],
        pipes: [],
        route_overrides: {},
        timing: {
          valve_travel_time: 15,
          flow_watchdog: 30,
          flow_confirm: 10,
          flow_threshold: 0.5,
          api_watchdog: 60,
          update_interval: 30,
        },
        automations: [],
      };

      const system = {
        id: systemId,
        friendlyName,
        board,
        directory: null,
        topology,
        deviceName: slug(friendlyName),
      };

      SiteRepository.addController(siteId, {
        id: system.id,
        friendlyName: system.friendlyName,
        board: system.board,
        directory: system.directory ?? undefined,
      }, {
        nodes: (system.topology as Record<string, unknown>).nodes as import('@far-mon/core').TopologyNode[] | undefined,
        pipes: (system.topology as Record<string, unknown>).pipes as import('@far-mon/core').PipeSegment[] | undefined,
        route_overrides: (system.topology as Record<string, unknown>).route_overrides as Record<string, import('@far-mon/core').RouteOverride> | undefined,
        timing: (system.topology as Record<string, unknown>).timing as Partial<import('@far-mon/core').SiteTopology['timing']> | undefined,
        automations: (system.topology as Record<string, unknown>).automations as import('@far-mon/core').Automation[] | undefined,
      });

      // Seed default secrets so generation doesn't fail on missing API/OTA keys
      db.setSecrets(siteId, systemId, generateDefaultSecrets() as unknown as Record<string, string>);

      return {
        id: systemId,
        board: system.board,
        friendlyName: system.friendlyName,
        directory: system.directory ?? undefined,
      };
    },
  );

  ipcMain.handle("system:delete", async (_e, siteId: string, systemId: string) => {
    SiteRepository.removeController(siteId, systemId);
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

  type ValidateRequest =
    | { kind: 'live'; topology: SiteTopology; board: BoardDef; controllerId: string }
    | { kind: 'saved'; siteId: string; controllerId: string };

  ipcMain.handle(
    "codegen:derive-routes",
    async (_e, topology: SiteTopology) => {
      const graph = buildGraph(topology.nodes, topology.pipes);
      const active = activeGraph(graph);
      const routes = deriveRoutes(active);
      return routes.map(r => ({ key: r.key, name: `${r.source}>${r.destination}` }));
    }
  );

  ipcMain.handle(
    "codegen:validate",
    async (_e, request: ValidateRequest) => {
      let topology: SiteTopology;
      let board: BoardDef;

      if (request.kind === 'live') {
        topology = request.topology;
        board = request.board;
      } else {
        const site = SiteRepository.loadFull(request.siteId);
        if (!site) throw new Error(`Site not found: ${request.siteId}`);
        topology = site.topology;
        const controller = topology.controllers.find(c => c.id === request.controllerId);
        if (!controller) throw new Error(`Controller not found: ${request.controllerId}`);
        const boardData = store.loadBoard(controller.board);
        if (!boardData?.board) throw new Error(`Board not found: ${controller.board}`);
        board = BoardDefSchema.parse(boardData.board) as BoardDef;
      }

      const manifest = buildManifest(topology, request.controllerId);
      return validateAll(topology, manifest, board);
    }
  );

  ipcMain.handle(
    "codegen:generate",
    async (_e, siteId: string, controllerId: string) => {
      const site = SiteRepository.loadFull(siteId);
      if (!site) throw new Error(`Site not found: ${siteId}`);

      const topology = site.topology;
      const controller = topology.controllers.find(c => c.id === controllerId);
      if (!controller) throw new Error(`Controller not found: ${controllerId}`);

      const boardData = store.loadBoard(controller.board);
      if (!boardData?.board) throw new Error(`Board not found: ${controller.board}`);
      const board = BoardDefSchema.parse(boardData.board) as BoardDef;

      const manifest = buildManifest(topology, controllerId);
      const validation = validateAll(topology, manifest, board);
      if (!validation.ok) {
        const errors = validation.diagnostics
          .filter(d => d.severity === 'error')
          .map(d => d.message);
        throw new Error(errors.join('\n'));
      }

      // Load secrets from DB, falling back to defaults
      const savedSecrets = db.getSecrets(siteId, controllerId);
      const secrets: SecretsMap = {
        ...generateDefaultSecrets(),
        ...savedSecrets,
      } as SecretsMap;

      // Validate secrets before generating so ESPHome doesn't fail with a cryptic error
      const transport = effectiveTransport(manifest.device.network, boardSupportedTransports(board));
      if (transport === 'wifi') {
        if (!secrets.wifi_ssid) {
          throw new Error('WiFi SSID is not configured. Open the Deploy panel, select this controller, and set the WiFi SSID and password in the Connectivity card.');
        }
        if (!secrets.wifi_password || secrets.wifi_password.length < 8) {
          throw new Error('WiFi password must be at least 8 characters. Open the Deploy panel, select this controller, and set the WiFi password in the Connectivity card.');
        }
      }

      // Compute generation metadata before building firmware so it can be embedded.
      const configSha = db.inputChecksum(topology, board, { ...secrets });
      const gen = db.createGeneration(siteId, controllerId, topology, board, 'esphome', { ...secrets });
      const latestMeta = gen ? null : db.listGenerations(siteId, controllerId, 'esphome')[0] ?? null;
      const version = gen?.version ?? latestMeta?.version ?? '';

      const metadata: GenerationMetadata = {
        configSha,
        version,
        siteId,
        controllerId,
        schemaVersion: store.SCHEMA_VERSION,
        buildTimestamp: Math.floor(Date.now() / 1000),
        appVersion: app.getVersion(),
      };

      const files = generateFirmware('esphome', manifest, board, siteId, secrets, metadata);

      const deviceFolder = manifest.device.directory ?? manifest.device.name;
      // Full path from outputDir to the device folder (used by Deploy panel to open it).
      const deviceDir = `sites/${siteId}/esphome/${deviceFolder}`;

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      if (gen) {
        db.finalizeGeneration(gen.id, files.length);
        db.pruneGenerations(siteId, controllerId, 10, 'esphome');
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

  ipcMain.handle(
    "codegen:restore",
    async (_e, siteId: string, controllerId: string, generationId: number) => {
      const snapshot = db.loadGeneration(generationId);
      if (!snapshot) throw new Error(`Generation not found: ${generationId}`);

      // Backward compat: old snapshots may have stored SystemTopology (filtered)
      // or SiteTopology. parseTopology handles both via migrateTopology.
      const topology = parseTopology(JSON.parse(snapshot.topology));
      const board = BoardDefSchema.parse(JSON.parse(snapshot.board)) as BoardDef;

      const manifest = buildManifest(topology, controllerId);
      const validation = validateAll(topology, manifest, board);
      if (!validation.ok) {
        const errors = validation.diagnostics
          .filter(d => d.severity === 'error')
          .map(d => d.message);
        throw new Error(errors.join('\n'));
      }

      // Load secrets from DB, falling back to defaults
      const savedSecrets = db.getSecrets(siteId, controllerId);
      const secrets: SecretsMap = {
        ...generateDefaultSecrets(),
        ...savedSecrets,
      } as SecretsMap;

      // Validate secrets before generating so ESPHome doesn't fail with a cryptic error
      const transport = effectiveTransport(manifest.device.network, boardSupportedTransports(board));
      if (transport === 'wifi') {
        if (!secrets.wifi_ssid) {
          throw new Error('WiFi SSID is not configured. Open the Deploy panel, select this controller, and set the WiFi SSID and password in the Connectivity card.');
        }
        if (!secrets.wifi_password || secrets.wifi_password.length < 8) {
          throw new Error('WiFi password must be at least 8 characters. Open the Deploy panel, select this controller, and set the WiFi password in the Connectivity card.');
        }
      }

      // Compute generation metadata before building firmware so it can be embedded.
      const configSha = db.inputChecksum(topology, board, { ...secrets });
      const gen = db.createGeneration(siteId, controllerId, topology, board, 'esphome', { ...secrets });
      const latestMeta = gen ? null : db.listGenerations(siteId, controllerId, 'esphome')[0] ?? null;
      const version = gen?.version ?? latestMeta?.version ?? '';

      const metadata: GenerationMetadata = {
        configSha,
        version,
        siteId,
        controllerId,
        schemaVersion: store.SCHEMA_VERSION,
        buildTimestamp: Math.floor(Date.now() / 1000),
        appVersion: app.getVersion(),
      };

      const files = generateFirmware('esphome', manifest, board, siteId, secrets, metadata);

      const deviceFolder = manifest.device.directory ?? manifest.device.name;
      const deviceDir = `sites/${siteId}/esphome/${deviceFolder}`;

      const outputDir = store.getOutputDir();
      store.writeOutput(files, outputDir);

      if (gen) {
        db.finalizeGeneration(gen.id, files.length);
        db.pruneGenerations(siteId, controllerId, 10, 'esphome');
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
      const site = SiteRepository.loadFull(siteId);
      if (!site) throw new Error(`Site not found: ${siteId}`);

      const systems: Array<import("./lib/generators/site-dashboard.js").SiteDashboardSystem> = [];
      const manifests = new Map<string, import("./lib/schema.js").Manifest>();
      const warnings: string[] = [];

      const fullTopology = site.topology;

      for (const ctrl of fullTopology.controllers) {
        const manifest = topologyToManifestForController(fullTopology, ctrl.id);
        const boardData = store.loadBoard(ctrl.board);
        if (!boardData?.board) {
          warnings.push(`Board not found for controller "${ctrl.id}": ${ctrl.board}`);
          continue;
        }
        const board = BoardDefSchema.parse(boardData.board);

        const validation = validateAll(fullTopology, manifest, board);
        if (!validation.ok) {
          const errors = validation.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
          if (errors.length > 0) {
            warnings.push(`Controller "${ctrl.id}" has validation errors — skipped in dashboard: ${errors.join('; ')}`);
            continue;
          }
        }

        systems.push({ systemId: ctrl.id, friendlyName: ctrl.friendlyName ?? ctrl.id, manifest, board });
        manifests.set(ctrl.id, manifest);
      }

      if (systems.length === 0) {
        throw new Error(`No valid controllers for dashboard generation.\n${warnings.join('\n')}`);
      }

      const files = generateSiteHA(siteId, site.site.friendlyName, systems, manifests);

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
    async (_e, boardModel: string, secretsRaw: Record<string, string>, network?: import('@far-mon/core').NetworkConfig) => {
      const boardData = store.loadBoard(boardModel);
      const board = BoardDefSchema.parse(boardData.board) as BoardDef;
      const { wifi_ssid, wifi_password, api_key, ota_password } = secretsRaw;
      if (!api_key || !ota_password) {
        throw new Error('Missing required secrets (api_key, ota_password)');
      }
      const secrets: SecretsMap = { wifi_ssid: wifi_ssid ?? '', wifi_password: wifi_password ?? '', api_key, ota_password };
      const files = generateSelfTest(board, secrets, network);
      const model = board.model.replace('_', '-');
      // Full path from outputDir to the self-test device folder.
      const deviceDir = `selftest/${model}/esphome/selftest-${model}`;

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
      siteTopology: SiteTopology,
      routesRaw: Route[],
    ) => {
      // Derive manifests and board data for each controller
      const systems = siteTopology.controllers.map(ctrl => {
        const manifest = topologyToManifestForController(siteTopology, ctrl.id);
        const usages = collectPins(siteTopology.nodes);
        // Load board SVG and compute pin overlays for per-device sections
        let boardSvg: string | undefined;
        let pinOverlays: ReturnType<typeof computePinOverlays> | undefined;
        let pinTable: PinTableRow[] | undefined;
        let boardLabel: string | undefined;
        let activeTransport: ReturnType<typeof effectiveTransport> | undefined;
        try {
          const boardData = store.loadBoard(ctrl.board);
          if (boardData?.svg && boardData?.board) {
            boardSvg = boardData.svg;
            const board = BoardDefSchema.parse(boardData.board);
            boardLabel = board.label;
            activeTransport = effectiveTransport(manifest.device.network, boardSupportedTransports(board));
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
        // Per-system secrets (wifi creds embedded in the recovery doc so a
        // field installer can read literal SSID + password without opening
        // secrets.yaml). Pulled per-(siteId, systemId) — never shared across
        // devices, never synthesised. Missing secrets → fields stay undefined,
        // and the doc renders an em-dash placeholder.
        const sysSecrets = (db.getSecrets(siteId, ctrl.id) ?? {}) as Record<string, string>;
        const wifiSsid = activeTransport === 'wifi' ? sysSecrets.wifi_ssid : undefined;
        const wifiPassword = activeTransport === 'wifi' ? sysSecrets.wifi_password : undefined;
        const staticIp = manifest.device.network?.mode === 'static'
          ? manifest.device.network?.static_ip
          : undefined;

        return {
          systemId: ctrl.id,
          friendlyName: ctrl.friendlyName ?? ctrl.id,
          board: ctrl.board,
          boardLabel,
          activeTransport,
          wifiSsid,
          wifiPassword,
          staticIp,
          deviceName: ctrl.id,
          manifest,
          boardSvg,
          pinOverlays,
          pinTable,
          topologySvg: perSystemSvgs[ctrl.id] ?? '',
        };
      });

      const html = generateSiteDocumentation(
        SiteRepository.loadFull(siteId)?.site.friendlyName ?? siteId,
        systems,
        compositeSvg,
        routesRaw,
      );

      // Write to output dir, scoped under the site's tree.
      const outputDir = store.getOutputDir();
      const filePath = `sites/${siteId}/site-documentation.html`;
      const fullPath = require('node:path').join(outputDir, filePath);
      require('node:fs').mkdirSync(require('node:path').dirname(fullPath), { recursive: true });
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
      if (!SiteRepository.loadFull(siteId)) throw new Error(`Site not found: ${siteId}`);
      const outputDir = store.getOutputDir();
      const files: Array<{ relativePath: string; content: string }> = [];
      for (const a of artifacts) {
        const base = `sites/${siteId}/homeassistant/www/farm/${a.name}`;
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
    const { result } = await esphome.compile(winFromEvent(event), configName);
    return result;
  });

  ipcMain.handle(
    "esphome:flash",
    async (event, configName: string, device?: string) => {
      const { result } = await esphome.flash(winFromEvent(event), configName, device);
      return result;
    }
  );

  ipcMain.handle(
    "esphome:logs",
    async (event, configName: string, device?: string) => {
      const { result } = await esphome.logs(winFromEvent(event), configName, device);
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
    if (SiteRepository.list().length > 0) return false;
    return store.hasLegacyData();
  });

  ipcMain.handle("legacy:scan", async () => store.scanLegacyData());

  ipcMain.handle("legacy:import", async (_e, sites: store.LegacyImportResult['sites']) => {
    let imported = 0;
    for (const site of sites) {
      // Skip if site ID already exists
      const existing = SiteRepository.loadFull(site.id);
      if (existing) continue;

      const topology = legacySystemsToSiteTopology(
        site.systems.map(s => ({
          id: s.id,
          friendlyName: s.friendlyName,
          board: s.board,
          directory: s.directory,
          topology: s.topology,
          deviceName: s.id,
        })),
        site.links,
      );
      SiteRepository.create(site.id, site.friendlyName);
      SiteRepository.save(site.id, topology);

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

  // =========================================================================
  // System settings
  // =========================================================================

  ipcMain.handle("settings:get", async (_e, siteId: string, systemId: string, key: string) =>
    db.getSetting(siteId, systemId, key)
  );

  ipcMain.handle("settings:set", async (_e, siteId: string, systemId: string, key: string, value: string) => {
    db.setSetting(siteId, systemId, key, value);
    return { ok: true };
  });

  ipcMain.handle("settings:get-all", async (_e, siteId: string, systemId: string) =>
    db.getSettings(siteId, systemId)
  );

  // =========================================================================
  // Fleet telemetry & drift detection
  // =========================================================================

  ipcMain.handle("drift:check", async (_e, siteId: string) => {
    const haUrl = db.getAppSetting('ha_url');
    const haToken = db.getAppSetting('ha_token');
    if (!haUrl || !haToken) {
      throw new Error('Home Assistant connection not configured. Open Deploy → Fleet Status to set URL and token.');
    }
    const conn: HaConnection = { baseUrl: haUrl, token: haToken };
    return checkSiteDrift(conn, siteId);
  });

  ipcMain.handle("drift:ha-check", async (_e) => {
    const haUrl = db.getAppSetting('ha_url');
    const haToken = db.getAppSetting('ha_token');
    if (!haUrl || !haToken) {
      return { ok: false, error: 'Not configured' };
    }
    return checkHaConnection({ baseUrl: haUrl, token: haToken });
  });

  // =========================================================================
  // Coordinated deployment (site-wide phased rollout)
  // =========================================================================

  ipcMain.handle("deployment:plan", async (_e, siteId: string, targetControllers?: string[]) => {
    return buildDeploymentPlan(siteId, targetControllers);
  });

  ipcMain.handle("deployment:execute", async (event, plan: DeploymentPlan) => {
    const haUrl = db.getAppSetting('ha_url');
    const haToken = db.getAppSetting('ha_token');
    const haConn = haUrl && haToken ? { baseUrl: haUrl, token: haToken } : undefined;
    return executeDeployment(winFromEvent(event), plan, haConn);
  });

  ipcMain.handle("deployment:rollback", async (event, siteId: string, controllerId: string) => {
    const haUrl = db.getAppSetting('ha_url');
    const haToken = db.getAppSetting('ha_token');
    const haConn = haUrl && haToken ? { baseUrl: haUrl, token: haToken } : undefined;
    return rollbackDeployment(winFromEvent(event), siteId, controllerId, haConn);
  });

  // =========================================================================
  // App settings (HA connection, global preferences)
  // =========================================================================

  ipcMain.handle("app-setting:get", async (_e, key: string) => db.getAppSetting(key));

  ipcMain.handle("app-setting:set", async (_e, key: string, value: string) => {
    db.setAppSetting(key, value);
    return { ok: true };
  });

  // =========================================================================
  // Topology event log (time-travel)
  // =========================================================================

  ipcMain.handle("events:list", async (_e, siteId: string, limit?: number) =>
    db.listTopologyEvents(siteId, limit)
  );

  ipcMain.handle("events:count", async (_e, siteId: string) =>
    db.topologyEventCount(siteId)
  );

  ipcMain.handle("events:reconstruct", async (_e, siteId: string, eventId: number) => {
    const { listEvents } = await import("./lib/event-store.js");
    const { reconstructTopology } = await import("./lib/reconstruct-topology.js");
    const events = listEvents(siteId);
    return reconstructTopology(events, eventId);
  });

  // =========================================================================
  // Product Catalog
  // =========================================================================

  function exportCatalogForQuote() {
    try {
      const lines = db.listActiveCatalogItems();
      const defaults = db.getQuoteDefaults();
      const payload = {
        registry: COMPONENT_REGISTRY,
        lines: lines.map((r) => ({
          id: r.id,
          componentId: r.component_id,
          manufacturer: r.manufacturer,
          name: r.name,
          manufacturerPartNumber: r.manufacturer_pn ?? undefined,
          description: r.description ?? '',
          selectionHelp: r.selection_help ?? undefined,
          reliabilityScore: r.reliability_score ?? undefined,
          baseSpecs: JSON.parse(r.base_specs || '{}'),
          variants: JSON.parse(r.variants || '[]'),
          isActive: r.is_active === 1,
          isUserDefined: r.is_user_defined === 1,
        })),
        defaults: defaults.map((d) => ({
          componentId: d.component_id,
          manufacturerId: d.manufacturer_id,
          params: JSON.parse(d.params || '{}'),
        })),
      };
      const quoteDir = path.join(process.cwd(), "homepage");
      fs.mkdirSync(quoteDir, { recursive: true });
      fs.writeFileSync(
        path.join(quoteDir, "catalog.json"),
        JSON.stringify(payload, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error("[catalog:export-for-quote] failed:", err);
    }
  }

  ipcMain.handle("catalog:list", async (_e, componentId?: string) =>
    db.listCatalogItems(componentId),
  );

  ipcMain.handle("catalog:active", async (_e, componentId?: string) =>
    db.listActiveCatalogItems(componentId),
  );

  ipcMain.handle("catalog:get", async (_e, id: string) =>
    db.getCatalogItem(id),
  );

  ipcMain.handle("catalog:upsert", async (_e, item: db.ProductLineRow) => {
    db.upsertCatalogItem(item);
    exportCatalogForQuote();
    return { ok: true };
  });

  ipcMain.handle("catalog:deactivate", async (_e, id: string) => {
    db.deactivateCatalogItem(id);
    exportCatalogForQuote();
    return { ok: true };
  });

  ipcMain.handle("catalog:export-for-quote", async () => {
    exportCatalogForQuote();
    return { ok: true };
  });

  ipcMain.handle("quote-defaults:get", async () => db.getQuoteDefaults());

  ipcMain.handle("quote-defaults:set", async (_e, componentId: string, manufacturerId: string, params: string) => {
    db.setQuoteDefaults(componentId, manufacturerId, params);
    exportCatalogForQuote();
    return { ok: true };
  });

  // =========================================================================
  // Site Manifests (Quotations / BOM snapshots)
  // =========================================================================

  ipcMain.handle("manifest:list", async (_e, siteId: string) =>
    db.listManifests(siteId),
  );

  ipcMain.handle("manifest:latest", async (_e, siteId: string) =>
    db.getLatestManifest(siteId),
  );

  ipcMain.handle("manifest:get", async (_e, siteId: string, version: number) =>
    db.getManifest(siteId, version),
  );

  ipcMain.handle("manifest:save", async (_e, siteId: string, data: db.ManifestInsert) =>
    db.saveManifest(siteId, data),
  );

  // =========================================================================
  // Product Feedback (field reliability)
  // =========================================================================

  ipcMain.handle("feedback:list", async (_e, catalogId?: string) =>
    db.listFeedback(catalogId),
  );

  ipcMain.handle("feedback:add", async (_e, data: db.FeedbackInsert) => {
    db.addFeedback(data);
    return { ok: true };
  });

  // =========================================================================
  // Google Drive Backup
  // =========================================================================

  ipcMain.handle("backup:auth", async () => {
    const { startOAuthFlow } = await import("./lib/backup/oauth.js");
    const tokens = await startOAuthFlow();
    db.setAppSetting("gdrive_refresh_token", tokens.refresh_token);
    return { ok: true };
  });

  ipcMain.handle("backup:status", async () => {
    const refreshToken = db.getAppSetting("gdrive_refresh_token");
    return { configured: !!refreshToken };
  });

  ipcMain.handle("backup:upload-site", async (_e, siteId: string) => {
    const refreshToken = db.getAppSetting("gdrive_refresh_token");
    if (!refreshToken) throw new Error("Google Drive not configured");

    const { refreshAccessToken } = await import("./lib/backup/oauth.js");
    const { ensureBackupFolder, uploadFile } = await import("./lib/backup/google-drive.js");

    const tokens = await refreshAccessToken(refreshToken);
    const folderId = await ensureBackupFolder(tokens.access_token);

    const full = SiteRepository.loadFull(siteId);
    const json = JSON.stringify(full, null, 2);
    const fileName = `site-${siteId}-${Date.now()}.json`;

    await uploadFile(tokens.access_token, folderId, fileName, "application/json", Buffer.from(json));
    return { ok: true };
  });

  ipcMain.handle("backup:upload-db", async () => {
    const refreshToken = db.getAppSetting("gdrive_refresh_token");
    if (!refreshToken) throw new Error("Google Drive not configured");

    const { refreshAccessToken } = await import("./lib/backup/oauth.js");
    const { ensureBackupFolder, uploadFile, compressBuffer } = await import("./lib/backup/google-drive.js");

    const tokens = await refreshAccessToken(refreshToken);
    const folderId = await ensureBackupFolder(tokens.access_token);

    const dbPath = store.getStorePath(); // actually need the full DB path
    const fullDbPath = require("node:path").join(dbPath, "generations.db");
    const compressed = await compressBuffer(require("node:fs").readFileSync(fullDbPath));
    const fileName = `majiflow-db-${new Date().toISOString().slice(0, 10)}.db.gz`;

    await uploadFile(tokens.access_token, folderId, fileName, "application/gzip", compressed);
    return { ok: true };
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
