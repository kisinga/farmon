import { Injectable } from '@angular/core';
import PocketBase, { type RecordModel } from 'pocketbase';
import { strToU8, zipSync } from 'fflate';
import {
  buildGraph,
  deriveRoutes,
  parseTopology,
  topologyToManifestForController,
  parseBoardDef,
  parseExpansionBoardDef,
  parseSiteImport,
  CURRENT_SCHEMA_VERSION,
} from '@core';
import type { ExpansionBoardCatalog, ExpansionBoardDef, CommandAction, DeploymentMode } from '@core';
import {
  generateEsphome,
  generateDefaultSecrets,
  type GeneratedFile,
  type SecretsMap,
  type GenerationMetadata,
} from '@core/codegen';

/** Firmware app version stamped into generation metadata (fleet provenance). */
const APP_VERSION = '1.0.0';

/** Firmware deployment config (server-level): where devices reach the broker. */
interface DeploymentConfig {
  brokerAddress: string;
  brokerPort: number;
  mode: DeploymentMode;
}
import { validateAll } from '@core/rules';
import type {
  SiteListEntry,
  SiteFullPayload,
  SiteSavePayload,
  BoardListEntry,
  BoardLoadResult,
  BoardDef,
  Controller,
  ValidateRequest,
  ValidationResult,
  GenerateResult,
  SiteTopology,
  VersionEntry,
  CommitResult,
} from '../models/backend-api';

/**
 * PocketBase base URL. When the SPA is served by maji-server it is same-origin;
 * a dev override can be injected on `window` (e.g. when running `ng serve`
 * against a local backend on :8090).
 */
const PB_URL: string =
  (globalThis as { __MAJI_PB_URL__?: string }).__MAJI_PB_URL__ ?? '/';

/**
 * BackendService — the single gateway from the Angular app to the MajiFlow
 * backend. Site/controller persistence, auth, and the board catalog go through
 * PocketBase; pure domain operations (route derivation, validation, ESPHome
 * generation) run against `@core` in the browser:
 *   - domain types/graph        → `@core`
 *   - validation rule engine     → `@core/rules`
 *   - ESPHome generators         → `@core/codegen`
 */
@Injectable({ providedIn: 'root' })
export class BackendService {
  readonly pb = new PocketBase(PB_URL);

  // --- Sites ---------------------------------------------------------------

  async siteList(): Promise<SiteListEntry[]> {
    const records = await this.pb
      .collection('sites')
      .getFullList({ sort: 'name' });
    return records.map((r) => this.toListEntry(r));
  }

  async siteLoad(id: string): Promise<SiteFullPayload> {
    const r = await this.pb.collection('sites').getOne(id);
    const mode = r['mode'];
    const deployment = (mode === 'managed' || mode === 'local')
      ? {
          mode,
          brokerHost: (r['broker_host'] ?? '') as string,
          brokerPort: (r['broker_port'] ?? 0) as number,
          brokerTls: !!r['broker_tls'],
        }
      : undefined;
    return {
      site: { id: r['id'], friendlyName: r['name'], deployment },
      topology: (r['draft_topology'] ?? null) as SiteFullPayload['topology'],
    };
  }

  async siteSave(payload: SiteSavePayload): Promise<void> {
    const d = payload.site.deployment;
    await this.pb.collection('sites').update(payload.site.id, {
      name: payload.site.friendlyName,
      draft_topology: payload.topology,
      ...(d
        ? { mode: d.mode, broker_host: d.brokerHost, broker_port: d.brokerPort, broker_tls: d.brokerTls }
        : {}),
    });
  }

  async siteCreate(slug: string, friendlyName: string): Promise<{ id: string }> {
    const r = await this.pb.collection('sites').create({
      name: friendlyName,
      slug,
      draft_topology: null,
      owner: this.pb.authStore.record?.id ?? null,
    });
    return { id: r['id'] };
  }

  async siteRename(id: string, friendlyName: string): Promise<void> {
    await this.pb.collection('sites').update(id, { name: friendlyName });
  }

  async siteDelete(id: string): Promise<void> {
    await this.pb.collection('sites').delete(id);
  }

  async siteExport(id: string): Promise<{ json: string }> {
    const payload = await this.siteLoad(id);
    return { json: JSON.stringify(payload, null, 2) };
  }

  async siteImport(text: string): Promise<{ id: string }> {
    // Validate + migrate the payload via core (throws on malformed JSON/graph)
    // instead of trusting a raw cast.
    const parsed = parseSiteImport(JSON.parse(text));
    const r = await this.pb.collection('sites').create({
      name: parsed.friendlyName,
      slug: this.slugify(parsed.friendlyName),
      draft_topology: parsed.topology,
      owner: this.pb.authStore.record?.id ?? null,
    });
    return { id: r['id'] };
  }

  // --- Controllers ("systems") --------------------------------------------
  //
  // Controllers live inside `sites.draft_topology`. `systemCreateBlank` mints a
  // Controller that the workspace appends to the topology and persists via
  // `siteSave`; `systemDelete` is a no-op server-side because the subsequent
  // topology save records the removal.

  async systemCreateBlank(
    _siteId: string,
    friendlyName: string,
    board: string,
  ): Promise<Controller> {
    return {
      id: this.newControllerId(friendlyName),
      board,
      friendlyName,
    };
  }

  async systemDelete(_siteId: string, _systemId: string): Promise<void> {
    // Removal is persisted by the workspace's subsequent siteSave().
  }

  // --- Boards (DB catalog) ------------------------------------------------
  //
  // The `boards` collection is the source of truth. Records are keyed by
  // `model` (the id controllers reference); `def` holds the parsed board.yaml
  // and `svg` an optional diagram file.

  async boardList(): Promise<BoardListEntry[]> {
    const records = await this.pb
      .collection('boards')
      .getFullList({ sort: 'label' });
    return records.map((r) => ({
      id: r['id'],
      model: r['model'],
      label: r['label'] || r['model'],
      kind: r['kind'] === 'expansion' ? 'expansion' : 'main',
    }));
  }

  async boardLoad(model: string): Promise<BoardLoadResult> {
    const r = await this.pb
      .collection('boards')
      .getFirstListItem(this.pb.filter('model = {:m}', { m: model }));
    return {
      board: r['def'] as BoardDef,
      svg: r['svg'] ? this.pb.files.getURL(r, r['svg']) : null,
    };
  }

  /**
   * Expansion-board catalog (`{ model → def }`) for the codegen provider
   * factory and the editor's expansion-board picker. Replaces the former
   * hardcoded `BUILTIN_EXPANSION_BOARDS` map — the set is now DB data.
   */
  async expansionCatalog(): Promise<ExpansionBoardCatalog> {
    const records = await this.pb
      .collection('boards')
      .getFullList({ filter: this.pb.filter('kind = {:k}', { k: 'expansion' }) });
    const catalog: ExpansionBoardCatalog = {};
    for (const r of records) {
      catalog[r['model']] = r['def'] as ExpansionBoardDef;
    }
    return catalog;
  }

  /** True when the signed-in user may mutate the board catalog (admin-only). */
  get isAdmin(): boolean {
    return this.pb.authStore.record?.['role'] === 'admin';
  }

  /**
   * Import a board into the DB catalog from a JSON definition. The def is
   * validated by core (`parseBoardDef` / `parseExpansionBoardDef`) before any
   * write, so malformed boards are rejected up front. Main controller boards
   * additionally require an SVG diagram (the canvas renders pin overlays on it);
   * expansion boards are pure data. Server-side rule restricts this to admins.
   */
  async boardImport(
    defText: string,
    kind: 'main' | 'expansion',
    svg?: File,
  ): Promise<{ id: string }> {
    const raw: unknown = JSON.parse(defText);
    if (kind === 'expansion') {
      const def = parseExpansionBoardDef(raw);
      const r = await this.pb.collection('boards').create({
        model: def.model, label: def.label, kind: 'expansion', version: 1, def,
      });
      return { id: r['id'] };
    }
    const def = parseBoardDef(raw);
    if (!svg) throw new Error('Main controller boards require an SVG diagram file.');
    const r = await this.pb.collection('boards').create({
      model: def.model, label: def.label, kind: 'main', version: 1, def, svg,
    });
    return { id: r['id'] };
  }

  // --- Domain operations (run in-browser via @core) ---------------

  async deriveRoutes(
    topology: SiteTopology,
  ): Promise<Array<{ key: string; name: string }>> {
    const graph = buildGraph(topology.nodes, topology.pipes);
    return deriveRoutes(graph).map((r) => ({
      key: r.key,
      name: `${r.source} → ${r.destination}`,
    }));
  }

  async validate(request: ValidateRequest): Promise<ValidationResult> {
    let topo: SiteTopology;
    let board: BoardDef;
    let mode: DeploymentMode;
    const controllerId = request.controllerId;

    if (request.kind === 'live') {
      topo = request.topology;
      board = request.board;
      mode = request.mode ?? 'managed';
    } else {
      const loaded = await this.loadTopology(request.siteId);
      topo = loaded.topo;
      const ctrl = topo.controllers.find((c) => c.id === controllerId);
      if (!ctrl) throw new Error(`Controller "${controllerId}" not found in site.`);
      board = (await this.boardLoad(ctrl.board)).board;
      mode = loaded.site.deployment?.mode ?? 'managed';
    }

    const manifest = topologyToManifestForController(topo, controllerId);
    const expansionBoards = await this.expansionCatalog();
    // Validate against the site's chosen mode (online→managed, local), the same
    // mode generation bakes, so the editor surfaces exactly the cross-controller
    // errors generation enforces. Unchosen sites default to managed (online).
    return validateAll(topo, manifest, board, { expansionBoards, mode });
  }

  /**
   * Generate the ESPHome bundle for a single controller entirely in-browser,
   * zip it (with `fflate`), and return a downloadable object URL plus a file
   * manifest. The bundle is only config text + a `compile.sh` helper — no build
   * artifacts — so it stays a few KB.
   */
  async generate(
    siteId: string,
    controllerId: string,
  ): Promise<GenerateResult> {
    const { topo, site } = await this.loadTopology(siteId);
    const ctrl = topo.controllers.find((c) => c.id === controllerId);
    if (!ctrl) throw new Error(`Controller "${controllerId}" not found in site.`);

    // Deployment (broker host/port + mode) is the site's saved Online/Local
    // choice; identity secrets are per-controller. Provision mints a fresh MQTT
    // token (rotated each build, only its hash stored) and a stable OTA password
    // (minted once, reused so OTA keeps working across rebuilds). Both are baked
    // into this build's secrets.yaml; wifi is NOT baked (captive portal → NVS).
    const deployment = await this.resolveDeployment(site);
    const prov = await this.provision(siteId, ctrl);
    const provisioned: SecretsMap = { ota_password: prov.ota_password, mqtt_token: prov.token };

    const expansionBoards = await this.expansionCatalog();
    const built = await this.buildController(topo, ctrl, siteId, expansionBoards, deployment, provisioned);
    const downloadUrl = URL.createObjectURL(this.zipBundle(built.files));

    return {
      files: built.files.map((f) => ({
        path: f.relativePath,
        description: f.description,
        lines: f.content.split('\n').length,
      })),
      downloadUrl,
      version: built.version,
    };
  }

  /**
   * Send an operator command to a controller. The server authorizes it, records
   * it for audit, and publishes it over MQTT; the device's shadow / transition
   * log reflects the outcome (the dashboard reconciles from there — there is no
   * reply channel). Returns the command id for correlation.
   */
  async sendCommand(
    siteId: string,
    controller: string,
    action: CommandAction,
    routeId?: number,
  ): Promise<string> {
    const res = await this.pb.send<{ command_id?: string }>('/api/farmon/command', {
      method: 'POST',
      body: { site: siteId, controller, action, route_id: routeId },
    });
    if (!res.command_id) throw new Error('Command was not accepted.');
    return res.command_id;
  }

  // --- Versioning / commit -------------------------------------------------

  /**
   * Commit the whole site: generate every controller's bundle, zip them
   * together, and store an immutable `topology_versions` row with the topology
   * snapshot. De-duplicated by `source_hash` — a no-op commit (inputs unchanged
   * since the latest version) returns that version without creating a new one.
   */
  async commit(siteId: string, note?: string): Promise<CommitResult> {
    const { topo, site } = await this.loadTopology(siteId);

    const expansionBoards = await this.expansionCatalog();
    const deployment = await this.resolveDeployment(site);
    const allFiles: GeneratedFile[] = [];
    const hashParts: string[] = [];
    for (const ctrl of topo.controllers) {
      const built = await this.buildController(topo, ctrl, siteId, expansionBoards, deployment);
      allFiles.push(...built.files);
      hashParts.push(built.hashPart);
    }
    const sourceHash = await sha256Hex(hashParts.join('|'));

    const prev = await this.latestVersion(siteId);
    if (prev && prev['source_hash'] === sourceHash) {
      return { id: prev['id'], version: prev['version'], deduped: true };
    }

    const nextVersion = ((prev?.['version'] as number) ?? 0) + 1;
    const blob = this.zipBundle(allFiles);

    const referenced = new Set<string>();
    for (const ctrl of topo.controllers) {
      referenced.add(ctrl.board);
      for (const p of ctrl.io_providers ?? []) referenced.add(p.type);
    }
    const boardVersions = await this.boardVersions(referenced);

    const fd = new FormData();
    fd.set('site', siteId);
    fd.set('version', String(nextVersion));
    fd.set('topology', JSON.stringify(topo));
    fd.set('board_versions', JSON.stringify(boardVersions));
    fd.set('source_hash', sourceHash);
    fd.set('committed_by', this.pb.authStore.record?.id ?? '');
    if (note) fd.set('note', note);
    fd.set('bundle', new File([blob], `bundle-v${nextVersion}.zip`, { type: 'application/zip' }));

    const rec = await this.pb.collection('topology_versions').create(fd);
    return { id: rec['id'], version: nextVersion, deduped: false };
  }

  /** List a site's committed versions, newest first. */
  async listVersions(siteId: string): Promise<VersionEntry[]> {
    const records = await this.pb.collection('topology_versions').getFullList({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-version',
    });
    return records.map((r) => ({
      id: r['id'],
      version: r['version'],
      sourceHash: r['source_hash'],
      note: r['note'] ?? '',
      committedAt: r['committed_at'] ?? r['created'] ?? '',
      bundleUrl: r['bundle'] ? this.pb.files.getURL(r, r['bundle']) : '',
    }));
  }

  /**
   * Roll the working draft back to a committed version's snapshot. Per the
   * versioning model this is non-destructive: it restores `draft_topology`;
   * re-committing then produces a new version.
   */
  async rollback(siteId: string, versionId: string): Promise<void> {
    const v = await this.pb.collection('topology_versions').getOne(versionId);
    await this.pb.collection('sites').update(siteId, {
      draft_topology: v['topology'],
    });
  }

  // --- Generation internals ------------------------------------------------

  private async loadTopology(siteId: string): Promise<{ topo: SiteTopology; site: SiteFullPayload['site'] }> {
    const { topology, site } = await this.siteLoad(siteId);
    if (!topology) throw new Error('Site has no topology to generate from.');
    return { topo: parseTopology(topology), site };
  }

  /**
   * Provision a controller's runtime identity. The server (re)registers the
   * controller (`device_id == controller.id`, the wire `{ctrl}` segment / broker
   * username), mints a fresh MQTT token (storing only its bcrypt hash, which the
   * broker checks on connect), and returns a stable OTA password (minted once,
   * reused across builds so OTA keeps authenticating). Both are baked into this
   * build's `secrets.yaml`.
   */
  private async provision(siteId: string, ctrl: Controller): Promise<{ token: string; ota_password: string }> {
    const res = await this.pb.send<{ token?: string; ota_password?: string }>('/api/farmon/provision', {
      method: 'POST',
      body: {
        site: siteId,
        controller: ctrl.id,
        name: ctrl.friendlyName ?? ctrl.id,
        board_type: ctrl.board,
      },
    });
    if (!res.token || !res.ota_password) throw new Error('Provisioning did not return the device secrets.');
    return { token: res.token, ota_password: res.ota_password };
  }

  /**
   * Firmware deployment config (broker host/port + mode) — server-level, fetched
   * once and cached for the session. Devices bake `brokerAddress:brokerPort` to
   * reach the broker; `MAJI_MQTT_PUBLIC_HOST` on the server must point at a host
   * the device can actually reach (its LAN IP / public name).
   */
  private cloudDefaults?: { host: string; port: number; tls: boolean };
  /** The managed-cloud broker defaults (mqtt.majiflow.io:8883 TLS) — the Online
   *  autofill source. Cached per session. */
  async cloudBrokerDefaults(): Promise<{ host: string; port: number; tls: boolean }> {
    if (this.cloudDefaults) return this.cloudDefaults;
    const res = await this.pb.send<{ broker_address?: string; broker_port?: number; broker_tls?: boolean }>(
      '/api/farmon/deployment',
      { method: 'GET' },
    );
    this.cloudDefaults = {
      host: res.broker_address ?? '',
      port: res.broker_port ?? 8883,
      tls: res.broker_tls ?? true,
    };
    return this.cloudDefaults;
  }

  /**
   * Resolve a site's effective deployment for generation/validation from its
   * saved choice. Managed (or unchosen) → the cloud broker defaults; local →
   * the site's own broker address (port falls back to the cloud default).
   */
  private async resolveDeployment(site: SiteFullPayload['site']): Promise<DeploymentConfig> {
    const cloud = await this.cloudBrokerDefaults();
    const d = site.deployment;
    if (!d || d.mode === 'managed') {
      return { mode: 'managed', brokerAddress: cloud.host, brokerPort: cloud.port };
    }
    return { mode: 'local', brokerAddress: d.brokerHost, brokerPort: d.brokerPort || cloud.port };
  }

  /** Build one controller's ESPHome files + its contribution to the source hash. */
  private async buildController(
    topo: SiteTopology,
    ctrl: Controller,
    siteId: string,
    expansionBoards: ExpansionBoardCatalog,
    deployment: DeploymentConfig,
    secrets?: SecretsMap,
  ): Promise<{ files: GeneratedFile[]; hashPart: string; version: string }> {
    const { board } = await this.boardLoad(ctrl.board);
    const manifest = topologyToManifestForController(topo, ctrl.id);

    // Deterministic hash over topology-derived inputs (manifest + board) —
    // drives the version string and commit de-duplication. Secrets are excluded
    // so regenerated credentials don't churn the version.
    const hashPart = JSON.stringify(manifest) + JSON.stringify(board);
    const sourceHash = await sha256Hex(hashPart);
    const metadata: GenerationMetadata = {
      configSha: sourceHash,
      version: sourceHash.slice(0, 8),
      siteId,
      controllerId: ctrl.id,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      buildTimestamp: Math.floor(Date.now() / 1000),
      appVersion: APP_VERSION,
      mode: deployment.mode,
      brokerAddress: deployment.brokerAddress,
      brokerPort: deployment.brokerPort,
    };

    // Validate against the deployment mode BEFORE emitting anything — never ship
    // a config that can't work. In particular, managed mode rejects
    // cross-controller routes/imports (those need local-mode peer coordination,
    // which is not yet built); without this, such a site silently generated
    // firmware referencing the removed Home Assistant services. Refuse with the
    // diagnostics instead.
    const validation = validateAll(topo, manifest, board, { expansionBoards, mode: metadata.mode });
    if (!validation.ok) {
      throw new Error(
        `Cannot generate "${ctrl.friendlyName ?? ctrl.id}" in ${metadata.mode} mode:\n- ` +
          validation.errors.join('\n- '),
      );
    }

    const files = generateEsphome(
      manifest,
      board,
      siteId,
      secrets ?? generateDefaultSecrets(),
      metadata,
      expansionBoards,
    );
    return { files, hashPart, version: metadata.version };
  }

  /**
   * Resolve `{ model → version }` for the given board models (controller main
   * boards + expansion provider types). Non-board references (e.g. the built-in
   * `modbus_controller` provider) are skipped. Recorded into the committed
   * version for board-revision traceability.
   */
  private async boardVersions(models: Set<string>): Promise<Record<string, number>> {
    if (models.size === 0) return {};
    const all = await this.pb.collection('boards').getFullList();
    const out: Record<string, number> = {};
    for (const r of all) {
      if (models.has(r['model'])) out[r['model']] = (r['version'] as number) ?? 0;
    }
    return out;
  }

  private async latestVersion(siteId: string): Promise<RecordModel | undefined> {
    const list = await this.pb.collection('topology_versions').getList(1, 1, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-version',
    });
    return list.items[0];
  }

  /** Zip a generated bundle into a Blob (text files only — stays tiny). */
  private zipBundle(files: GeneratedFile[]): Blob {
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.relativePath] = strToU8(f.content);
    const zipped = zipSync(entries, { level: 6 });
    // Copy into a fresh ArrayBuffer-backed view so the Blob owns its bytes.
    return new Blob([zipped.slice()], { type: 'application/zip' });
  }

  // --- Helpers -------------------------------------------------------------

  private toListEntry(r: RecordModel): SiteListEntry {
    const topo = r['draft_topology'] as SiteTopology | null;
    return {
      id: r['id'],
      friendlyName: r['name'],
      controllerCount: topo?.controllers?.length ?? 0,
      nodeCount: topo?.nodes?.length ?? 0,
    };
  }

  private newControllerId(friendlyName: string): string {
    const base = this.slugify(friendlyName) || 'controller';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

/** SHA-256 hex digest via Web Crypto. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
