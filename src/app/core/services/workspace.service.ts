import { Injectable, signal, computed } from '@angular/core';
import { BackendService } from './backend.service';
import { BoardService } from './board.service';
import { SitesStore } from '../stores/sites.store';
import type {
  BoardDef, TopologyGraph, Route,
  TopologyNode, PipeSegment, RouteOverride,
  SiteMetadata, SiteSavePayload, SiteTopology, Controller,
  SiteDeployment, CrossControllerReport,
} from '@core';

import {
  buildGraph, deriveRoutes, activeGraph, parseTopology, slug,
  controllerClaimsSegment, detectCrossControllerTalk, migrateToRemoteImports,
} from '@core';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {

  // --- Core state ---
  private _site = signal<SiteMetadata | null>(null);
  private _siteTopology = signal<SiteTopology | null>(null);
  private _boards = signal<Map<string, BoardDef>>(new Map());
  private _activeControllerId = signal<string | null>(null);
  private _dirty = signal(false);
  private _dirtyControllerIds = signal<Set<string>>(new Set());
  private _loading = signal(false);

  // --- Public readonly signals ---
  readonly site = this._site.asReadonly();
  readonly siteTopology = this._siteTopology.asReadonly();
  readonly boards = this._boards.asReadonly();
  readonly activeControllerId = this._activeControllerId.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly dirtyControllerIds = this._dirtyControllerIds.asReadonly();
  readonly loading = this._loading.asReadonly();

  // --- Deployment (Online/Local + broker) ---

  /** The site's saved Online/Local choice + broker, or undefined until picked. */
  readonly deployment = computed<SiteDeployment | undefined>(() => this._site()?.deployment);

  /** Effective mode for the site (defaults to managed/online when unchosen). */
  readonly deploymentMode = computed<'managed' | 'local'>(() => this._site()?.deployment?.mode ?? 'managed');

  /**
   * Whether this site is "live" — a real device has connected at least once
   * (liveCount), or hosting has started (commenceDate). Design is free until then:
   * drawing controllers and generating firmware never lock it; only deployed
   * hardware does. Drives the editor's design lock (read-only until an admin opts in).
   */
  readonly commissioned = computed<boolean>(() => {
    const id = this._site()?.id;
    if (!id) return false;
    const entry = this.sites.list().find((s) => s.id === id);
    return !!entry && (entry.liveCount > 0 || !!entry.commenceDate);
  });

  /** Live cross-controller (cross-talk) verdict for the current design. */
  readonly crossTalk = computed<CrossControllerReport | null>(() => {
    const t = this._siteTopology();
    return t ? detectCrossControllerTalk(t) : null;
  });

  /** Persist the site's deployment choice (marks the workspace dirty → autosaves). */
  setDeployment(deployment: SiteDeployment): void {
    const site = this._site();
    if (!site) return;
    this._site.set({ ...site, deployment });
    this._markDirty();
  }

  // --- Active controller computed signals ---

  readonly activeTopology = computed<SiteTopology | null>(() => {
    const topology = this._siteTopology();
    const cid = this._activeControllerId();
    if (!topology || !cid) return null;

    const controller = topology.controllers.find(c => c.id === cid);
    if (!controller) return null;

    // Return the site topology directly (all editor tabs operate on SiteTopology now).
    // Controller existence check is just a guard — if the active controller was
    // removed, the editor should not show stale topology.
    return topology;
  });

  readonly activeBoard = computed<BoardDef | null>(() => {
    const cid = this._activeControllerId();
    if (!cid) return null;
    return this._boards().get(cid) ?? null;
  });

  // --- All nodes across all controllers (for ID generation) ---

  readonly allNodes = computed<TopologyNode[]>(() => {
    return this._siteTopology()?.nodes ?? [];
  });

  // --- Flat graph (site-wide) ---

  readonly siteGraph = computed<TopologyGraph | null>(() => {
    const topology = this._siteTopology();
    if (!topology) return null;
    return buildGraph(topology.nodes, topology.pipes);
  });

  readonly siteRoutes = computed<Route[]>(() => {
    const graph = this.siteGraph();
    if (!graph) return [];
    return deriveRoutes(activeGraph(graph));
  });

  // --- Controller-level filtered routes ---

  readonly activeControllerRoutes = computed<Route[]>(() => {
    const cid = this._activeControllerId();
    const topology = this._siteTopology();
    if (!cid || !topology) return [];
    return this.siteRoutes().filter(r => controllerClaimsSegment(r, cid, topology));
  });

  private _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private backend: BackendService,
    private boardCatalog: BoardService,
    private sites: SitesStore,
  ) {}

  /** Mark dirty and schedule debounced autosave. Called by every mutation. */
  private _markDirty(controllerId?: string): void {
    this._dirty.set(true);
    if (controllerId) {
      this._dirtyControllerIds.update(s => new Set(s).add(controllerId));
    }
    this._scheduleAutosave();
  }

  private _scheduleAutosave(): void {
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      this._autosaveTimer = null;
      this.save().catch((err) => {
        console.error('[Workspace] Autosave failed:', err);
      });
    }, 800);
  }

  private _cancelAutosave(): void {
    if (this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  // --- Load ---

  /** Monotonic token: each load() bumps it; awaited steps bail once superseded. */
  private _loadSeq = 0;
  /** Site whose load currently owns the token, or null when idle. */
  private _loadingSiteId: string | null = null;
  /** Shared in-flight load promise, so duplicate callers reuse it (no second fetch). */
  private _loadInFlight: Promise<void> | null = null;

  /**
   * Load a site into the workspace. Idempotent and concurrency-safe:
   *   - a load for the same site already in flight is SHARED, not restarted. The
   *     editor recreates on every tab navigation (its three routes are distinct
   *     configs), so without this its second ngOnInit fired a duplicate `siteLoad`
   *     before the first resolved — the PB SDK auto-cancelled one, surfacing as a
   *     console error. This is the root-cause fix for that.
   *   - the same site already loaded and idle → no-op;
   *   - a different site supersedes any in-flight load via the token, so a slow
   *     earlier load can't clobber the newer site's state.
   */
  load(siteId: string): Promise<void> {
    if (this._loadingSiteId === siteId && this._loadInFlight) return this._loadInFlight;
    if (this._loadingSiteId === null && this._site()?.id === siteId) return Promise.resolve();

    const seq = ++this._loadSeq;
    this._loadingSiteId = siteId;
    this._loadInFlight = this._load(siteId, seq).finally(() => {
      if (seq === this._loadSeq) {
        this._loadingSiteId = null;
        this._loadInFlight = null;
      }
    });
    return this._loadInFlight;
  }

  private async _load(siteId: string, seq: number): Promise<void> {
    this.clear();
    this._loading.set(true);

    try {
      const payload = await this.backend.siteLoad(siteId);
      if (seq !== this._loadSeq) return; // superseded by a newer load
      this._site.set({ id: payload.site.id, friendlyName: payload.site.friendlyName, deployment: payload.site.deployment });
      // Pull the catalog so `commissioned` (the design lock) resolves even on a
      // deep-link that skipped the Overview. Reactive — late arrival flips the lock.
      void this.sites.ensureLoaded();

      if (payload.topology) {
        // Migrate the stored draft to the current schema (e.g. fold obsolete
        // standalone pressure_sensor nodes into their tank) and validate.
        // parseTopology returns a typed SiteTopology.
        let topology = parseTopology(payload.topology);

        // Pre-remoteImports drafts: derive cross-controller imports from routes.
        const stored = payload.topology as { remoteImports?: unknown };
        if (!stored.remoteImports) {
          topology = migrateToRemoteImports(topology);
          this._markDirty();
        }

        this._siteTopology.set(topology);

        // Load boards for each controller.
        const boards = new Map<string, BoardDef>();
        for (const ctrl of topology.controllers) {
          try {
            const boardResult = await this.boardCatalog.loadResult(ctrl.board);
            if (seq !== this._loadSeq) return; // superseded mid board-load
            boards.set(ctrl.id, boardResult.board as BoardDef);
          } catch (err) {
            console.error(`[Workspace] Failed to load board "${ctrl.board}" for controller "${ctrl.id}":`, err);
          }
        }
        this._boards.set(boards);
      } else {
        this._siteTopology.set({
          schema: 18,
          controllers: [],
          nodes: [],
          pipes: [],
          route_overrides: {},
          timing: {
            valve_travel_time: 15,
            flow_watchdog: 30,
            flow_confirm: 10,
            flow_threshold: 0.5,
            update_interval: 10,
          },
          remoteImports: [],
        });
      }

      this._dirty.set(false);
    } finally {
      if (seq === this._loadSeq) this._loading.set(false);
    }
  }

  /**
   * Restore a topology from event log reconstruction.
   * Marks the workspace dirty so it will be saved on next save.
   */
  restoreTopology(topology: SiteTopology): void {
    this._siteTopology.set(topology);
    this._markDirty();
  }

  // --- Focus ---

  focusController(controllerId: string): void {
    this._activeControllerId.set(controllerId);
  }

  unfocusController(): void {
    this._activeControllerId.set(null);
  }

  // --- Topology mutations ---

  updateController(controllerId: string, updater: (ctrl: Controller) => void): void {
    const topology = this._siteTopology();
    if (!topology) return;

    const clone = structuredClone(topology);
    const ctrlClone = clone.controllers.find(c => c.id === controllerId);
    if (!ctrlClone) return;

    updater(ctrlClone);

    this._siteTopology.set(clone);
    this._markDirty(controllerId);
  }

  updateSiteTopology(updater: (t: SiteTopology) => void): void {
    const topology = this._siteTopology();
    const cid = this._activeControllerId();
    if (!topology || !cid) return;

    const clone = structuredClone(topology);
    updater(clone);

    this._siteTopology.set(clone);
    this._markDirty(cid);
  }

  /** Atomically swap the board for the active controller. */
  changeActiveBoard(board: BoardDef): void {
    const topology = this._siteTopology();
    const cid = this._activeControllerId();
    if (!topology || !cid) return;

    const clone = structuredClone(topology);
    const controller = clone.controllers.find(c => c.id === cid);
    if (!controller) return;
    controller.board = board.model;

    const boards = new Map(this._boards());
    boards.set(cid, board);

    this._siteTopology.set(clone);
    this._boards.set(boards);
    this._markDirty(cid);
  }

  /** Persist a controller overlay node position in the site layout. */
  setControllerLayoutPosition(controllerId: string, position: { x: number; y: number }): void {
    const topology = this._siteTopology();
    if (!topology) return;
    const clone = structuredClone(topology);
    if (!clone.layout) clone.layout = { controllers: {} };
    if (!clone.layout.controllers) clone.layout.controllers = {};
    clone.layout.controllers[controllerId] = position;
    this._siteTopology.set(clone);
    this._markDirty(controllerId);
  }

  // --- Site metadata migrations ---

  updateSiteName(friendlyName: string): void {
    const site = this._site();
    if (!site) return;
    this._site.set({ ...site, friendlyName });
    this._markDirty();
  }

  // --- Controller management ---

  async addControllerFromTemplate(templateName: string, friendlyName?: string): Promise<string> {
    const site = this._site();
    if (!site) throw new Error('No site loaded');

    const controller = await this.backend.systemCreateBlank(site.id, friendlyName ?? 'New Controller', 'kc868-a16');

    // Load board for the new controller
    const boardResult = await this.boardCatalog.loadResult(controller.board);
    const board = boardResult.board as BoardDef;

    const topology = this._siteTopology();
    if (topology) {
      const clone = structuredClone(topology);
      clone.controllers.push(controller as Controller);
      this._siteTopology.set(clone);
    }

    const boards = new Map(this._boards());
    boards.set(controller.id, board);
    this._boards.set(boards);

    this._markDirty(controller.id);

    return controller.id;
  }

  async addBlankController(friendlyName: string, boardModel: string): Promise<string> {
    const site = this._site();
    if (!site) throw new Error('No site loaded');

    const controller = await this.backend.systemCreateBlank(site.id, friendlyName, boardModel);

    // Load board for the new controller
    const boardResult = await this.boardCatalog.loadResult(controller.board);
    const board = boardResult.board as BoardDef;

    const topology = this._siteTopology();
    if (topology) {
      const clone = structuredClone(topology);
      clone.controllers.push(controller as Controller);
      this._siteTopology.set(clone);
    }

    const boards = new Map(this._boards());
    boards.set(controller.id, board);
    this._boards.set(boards);

    this._markDirty(controller.id);

    return controller.id;
  }

  async removeController(controllerId: string): Promise<void> {
    const topology = this._siteTopology();
    const site = this._site();
    if (!topology || !site) return;

    // Persist deletion to backend
    await this.backend.systemDelete(site.id, controllerId);

    const clone = structuredClone(topology);
    clone.controllers = clone.controllers.filter(c => c.id !== controllerId);
    clone.nodes = clone.nodes.filter(n => n.anchorId !== controllerId);

    // Remove pipes that reference removed nodes
    const removedNodeIds = new Set(
      topology.nodes.filter(n => n.anchorId === controllerId).map(n => n.id)
    );
    clone.pipes = clone.pipes.filter(p => {
      const fromNode = p.from.split(':')[0];
      const toNode = p.to.split(':')[0];
      return !removedNodeIds.has(fromNode) && !removedNodeIds.has(toNode);
    });

    // Clean up route_overrides for removed nodes
    if (clone.route_overrides) {
      clone.route_overrides = Object.fromEntries(
        Object.entries(clone.route_overrides).filter(([key]) => !removedNodeIds.has(key))
      );
    }

    const boards = new Map(this._boards());
    boards.delete(controllerId);

    this._siteTopology.set(clone);
    this._boards.set(boards);

    if (this._activeControllerId() === controllerId) {
      this._activeControllerId.set(null);
    }

    this._dirtyControllerIds.update(s => { const n = new Set(s); n.delete(controllerId); return n; });
    this._markDirty();
  }


  // --- ID generation (site-wide unique) ---

  nextNodeId(kind: string): string {
    const allNodes = this.allNodes();
    const regex = new RegExp(`^${kind}(\\d+)$`);
    let max = 0;
    for (const node of allNodes) {
      if (node.kind !== kind) continue;
      const match = node.id.match(regex);
      if (match) max = Math.max(max, parseInt(match[1]));
      if (node.id === kind) max = Math.max(max, 1);
    }
    return `${kind}${max + 1}`;
  }

  nextPipeId(): string {
    const topology = this._siteTopology();
    let max = 0;
    for (const p of topology?.pipes ?? []) {
      const m = p.id.match(/^pipe(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `pipe${max + 1}`;
  }

  // --- Save (atomic) ---

  async save(): Promise<void> {
    const site = this._site();
    const topology = this._siteTopology();
    if (!site || !topology) return;

    const payload: SiteSavePayload = {
      site: { id: site.id, friendlyName: site.friendlyName, deployment: site.deployment },
      topology,
    };

    await this.backend.siteSave(payload);
    // Topology counts (controllers/nodes) on the cached site list are now stale.
    this.sites.invalidate();

    // Only clear dirty if state hasn't changed since we started saving.
    // This prevents races where a mutation happens during the async save.
    if (this._siteTopology() === topology && this._site() === site) {
      this._dirty.set(false);
      this._dirtyControllerIds.set(new Set());
    }
  }

  // --- Clear ---

  clear(): void {
    this._cancelAutosave();
    this._site.set(null);
    this._siteTopology.set(null);
    this._boards.set(new Map());
    this._activeControllerId.set(null);
    this._dirtyControllerIds.set(new Set());
    this._dirty.set(false);
    this._loading.set(false);
  }
}
