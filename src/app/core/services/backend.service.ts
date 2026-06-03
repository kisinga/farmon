import { Injectable } from '@angular/core';
import PocketBase, { type RecordModel } from 'pocketbase';
import { parse as parseYaml } from 'yaml';
import { strToU8, zipSync } from 'fflate';
import {
  buildGraph,
  deriveRoutes,
  parseTopology,
  topologyToManifestForController,
} from '@far-mon/core';
import {
  generateEsphome,
  generateDefaultSecrets,
  createTestMetadata,
  type GeneratedFile,
  type SecretsMap,
} from '@far-mon/core/codegen';
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

/** Assets base for static board definitions bundled into the SPA. */
const BOARDS_BASE = 'boards';

/**
 * BackendService — the single gateway from the Angular app to the MajiFlow
 * backend. Site/controller persistence and auth go through PocketBase; pure
 * domain operations (route derivation, validation) run against `@far-mon/core`
 * in the browser. Board definitions are served as static assets.
 *
 * NOTE (rewrite phasing): `validate` and `generate` are intentionally thin in
 * this slice. The validation rule engine and the ESPHome generators currently
 * live in `electron/lib/{rules,generators}`; Phase 3 relocates them into
 * `@far-mon/core` and wires the full implementations here.
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
    return {
      site: { id: r['id'], friendlyName: r['name'] },
      topology: (r['draft_topology'] ?? null) as SiteFullPayload['topology'],
    };
  }

  async siteSave(payload: SiteSavePayload): Promise<void> {
    await this.pb.collection('sites').update(payload.site.id, {
      name: payload.site.friendlyName,
      draft_topology: payload.topology,
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
    const parsed = JSON.parse(text) as SiteFullPayload;
    const r = await this.pb.collection('sites').create({
      name: parsed.site?.friendlyName ?? 'Imported Site',
      slug: this.slugify(parsed.site?.friendlyName ?? 'imported-site'),
      draft_topology: parsed.topology ?? null,
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

  // --- Boards (static assets) ---------------------------------------------

  async boardList(): Promise<BoardListEntry[]> {
    const res = await fetch(`${BOARDS_BASE}/index.json`);
    if (!res.ok) throw new Error(`boardList: ${res.status}`);
    return (await res.json()) as BoardListEntry[];
  }

  async boardLoad(model: string): Promise<BoardLoadResult> {
    const yamlRes = await fetch(`${BOARDS_BASE}/${model}/board.yaml`);
    if (!yamlRes.ok) throw new Error(`boardLoad("${model}"): ${yamlRes.status}`);
    const board = parseYaml(await yamlRes.text()) as BoardDef;

    let svg: string | null = null;
    const svgRes = await fetch(`${BOARDS_BASE}/${model}/board.svg`);
    if (svgRes.ok) svg = await svgRes.text();

    return { board, svg };
  }

  // --- Domain operations (run in-browser via @far-mon/core) ---------------

  async deriveRoutes(
    topology: SiteTopology,
  ): Promise<Array<{ key: string; name: string }>> {
    const graph = buildGraph(topology.nodes, topology.pipes);
    return deriveRoutes(graph).map((r) => ({
      key: r.key,
      name: `${r.source} → ${r.destination}`,
    }));
  }

  async validate(_request: ValidateRequest): Promise<ValidationResult> {
    // Phase 3 wires the full rule engine (currently in electron/lib/rules)
    // once it is relocated into @far-mon/core.
    return { ok: true, errors: [], warnings: [], diagnostics: [] };
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
    secrets?: SecretsMap,
  ): Promise<GenerateResult> {
    const { topo } = await this.loadTopology(siteId);
    const ctrl = topo.controllers.find((c) => c.id === controllerId);
    if (!ctrl) throw new Error(`Controller "${controllerId}" not found in site.`);

    const built = await this.buildController(topo, ctrl, siteId, secrets);
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

  // --- Versioning / commit -------------------------------------------------

  /**
   * Commit the whole site: generate every controller's bundle, zip them
   * together, and store an immutable `topology_versions` row with the topology
   * snapshot. De-duplicated by `source_hash` — a no-op commit (inputs unchanged
   * since the latest version) returns that version without creating a new one.
   */
  async commit(siteId: string, note?: string): Promise<CommitResult> {
    const { topo } = await this.loadTopology(siteId);

    const allFiles: GeneratedFile[] = [];
    const hashParts: string[] = [];
    for (const ctrl of topo.controllers) {
      const built = await this.buildController(topo, ctrl, siteId);
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

    const fd = new FormData();
    fd.set('site', siteId);
    fd.set('version', String(nextVersion));
    fd.set('topology', JSON.stringify(topo));
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

  private async loadTopology(siteId: string): Promise<{ topo: SiteTopology }> {
    const { topology } = await this.siteLoad(siteId);
    if (!topology) throw new Error('Site has no topology to generate from.');
    return { topo: parseTopology(topology) };
  }

  /** Build one controller's ESPHome files + its contribution to the source hash. */
  private async buildController(
    topo: SiteTopology,
    ctrl: Controller,
    siteId: string,
    secrets?: SecretsMap,
  ): Promise<{ files: GeneratedFile[]; hashPart: string; version: string }> {
    const { board } = await this.boardLoad(ctrl.board);
    const manifest = topologyToManifestForController(topo, ctrl.id);

    // Deterministic hash over topology-derived inputs (manifest + board) —
    // drives the version string and commit de-duplication. Secrets are excluded
    // so regenerated credentials don't churn the version.
    const hashPart = JSON.stringify(manifest) + JSON.stringify(board);
    const sourceHash = await sha256Hex(hashPart);
    const metadata = createTestMetadata({
      siteId,
      controllerId: ctrl.id,
      configSha: sourceHash,
      version: sourceHash.slice(0, 8),
      buildTimestamp: Math.floor(Date.now() / 1000),
    });

    const files = generateEsphome(
      manifest,
      board,
      siteId,
      secrets ?? generateDefaultSecrets(),
      metadata,
    );
    return { files, hashPart, version: metadata.version };
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
