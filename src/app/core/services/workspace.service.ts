import { Injectable, signal, computed } from '@angular/core';
import { ElectronService } from './electron.service';
import { LibraryService } from './library.service';
import type {
  SystemTopology, BoardDef, Site, SiteLink, BoundaryPort, TopologyGraph, Route,
  TopologyNode, PipeSegment, RouteOverride,
} from '@far-mon/core';
import {
  parseSite, boundaryPorts, buildCompositeGraph, deriveRoutes, activeGraph,
  parseSiteLinkRef, siteLinkRef,
} from '@far-mon/core';

// --- ID migration helpers ---

function remapPortRef(ref: string, remap: Map<string, string>): string {
  const [nodeId, portId] = ref.split(':');
  const newNodeId = remap.get(nodeId) ?? nodeId;
  return `${newNodeId}:${portId}`;
}

function remapRouteKey(key: string, remap: Map<string, string>): string {
  return key.split('>').map(id => remap.get(id) ?? id).join('>');
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {

  // --- Core site state ---
  private _site = signal<Site | null>(null);
  private _siteName = signal<string | null>(null);
  private _stale = signal(false);
  private _loading = signal(false);

  // --- All system data (single source of truth) ---
  private _systems = signal<Map<string, { topology: SystemTopology; board: BoardDef }>>(new Map());

  // --- Active system focus (which system is being edited) ---
  private _activeConfig = signal<string | null>(null);

  // --- Dirty tracking ---
  private _dirtyConfigs = signal<Set<string>>(new Set());
  private _siteDirty = signal(false);

  // --- Public readonly signals ---
  readonly site = this._site.asReadonly();
  readonly siteName = this._siteName.asReadonly();
  readonly systems = this._systems.asReadonly();
  readonly activeConfig = this._activeConfig.asReadonly();
  readonly stale = this._stale.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** Overall dirty: any system or site structure has pending changes. */
  readonly dirty = computed(() => this._dirtyConfigs().size > 0 || this._siteDirty());

  /** Is a specific system dirty? */
  isSystemDirty(config: string | null): boolean {
    return config ? this._dirtyConfigs().has(config) : false;
  }

  // --- Active system computed signals ---

  readonly activeTopology = computed<SystemTopology | null>(() => {
    const config = this._activeConfig();
    if (!config) return null;
    return this._systems().get(config)?.topology ?? null;
  });

  readonly activeBoard = computed<BoardDef | null>(() => {
    const config = this._activeConfig();
    if (!config) return null;
    return this._systems().get(config)?.board ?? null;
  });

  // --- All nodes across all systems (for ID generation) ---

  readonly allNodes = computed<TopologyNode[]>(() => {
    const result: TopologyNode[] = [];
    for (const [, { topology }] of this._systems()) {
      result.push(...topology.nodes);
    }
    return result;
  });

  // --- Composite topology (flat merge for canvas rendering) ---

  readonly compositeTopology = computed<SystemTopology | null>(() => {
    const site = this._site();
    const systems = this._systems();
    if (!site || systems.size === 0) return null;

    const allNodes: TopologyNode[] = [];
    const allPipes: PipeSegment[] = [];

    for (const sp of site.systems) {
      const data = systems.get(sp.config);
      if (!data) continue;

      for (const node of data.topology.nodes) {
        allNodes.push({
          ...node,
          position: {
            x: node.position.x + sp.position.x,
            y: node.position.y + sp.position.y,
          },
        } as TopologyNode);
      }
      allPipes.push(...data.topology.pipes);
    }

    return {
      schema: 8,
      device: { name: 'composite', friendly_name: 'Site', board: '' },
      nodes: allNodes,
      pipes: allPipes,
      route_overrides: {},
      timing: {
        valve_travel_time: '0s',
        flow_watchdog_seconds: 0,
        flow_confirm_seconds: 0,
        api_watchdog_seconds: 0,
        update_interval: '0s',
      },
      automations: [],
    };
  });

  // --- Composite graph (for cross-system route derivation) ---

  readonly compositeGraph = computed<TopologyGraph | null>(() => {
    const site = this._site();
    const systems = this._systems();
    if (!site || systems.size === 0) return null;

    const inputs = site.systems
      .filter(sp => systems.has(sp.config))
      .map(sp => ({
        configName: sp.config,
        topology: systems.get(sp.config)!.topology,
      }));

    return buildCompositeGraph(inputs, site.links);
  });

  readonly compositeRoutes = computed<Route[]>(() => {
    const graph = this.compositeGraph();
    if (!graph) return [];
    return deriveRoutes(activeGraph(graph));
  });

  readonly boundaryPortsBySystem = computed<Map<string, BoundaryPort[]>>(() => {
    const systems = this._systems();
    const result = new Map<string, BoundaryPort[]>();
    for (const [config, { topology }] of systems) {
      result.set(config, boundaryPorts(topology));
    }
    return result;
  });

  readonly brokenLinks = computed<SiteLink[]>(() => {
    const site = this._site();
    const systems = this._systems();
    if (!site) return [];

    return site.links.filter(link => {
      try {
        const fromConfig = link.from.split('/')[0];
        const toConfig = link.to.split('/')[0];
        return !systems.has(fromConfig) || !systems.has(toConfig);
      } catch {
        return true;
      }
    });
  });

  readonly unlinkedHandoffs = computed<Array<{ config: string; nodeId: string; nodeName: string }>>(() => {
    const site = this._site();
    const systems = this._systems();
    if (!site) return [];

    const linkedNodeIds = new Set<string>();
    for (const link of site.links) {
      try {
        const from = parseSiteLinkRef(link.from);
        const to = parseSiteLinkRef(link.to);
        linkedNodeIds.add(`${from.config}/${from.nodeId}`);
        linkedNodeIds.add(`${to.config}/${to.nodeId}`);
      } catch { /* skip invalid */ }
    }

    const result: Array<{ config: string; nodeId: string; nodeName: string }> = [];
    for (const [config, { topology }] of systems) {
      for (const node of topology.nodes) {
        if (node.kind === 'handoff' && !linkedNodeIds.has(`${config}/${node.id}`)) {
          result.push({ config, nodeId: node.id, nodeName: (node as any).name ?? node.id });
        }
      }
    }
    return result;
  });

  constructor(
    private electron: ElectronService,
    private library: LibraryService,
  ) {}

  // --- Load ---

  async load(siteName: string): Promise<void> {
    this.clear();
    this._loading.set(true);
    this._siteName.set(siteName); // set early so guards can check which site is loading

    try {
      const raw = await this.electron.siteLoad(siteName);
      const site = parseSite(raw);

      const systems = new Map<string, { topology: SystemTopology; board: BoardDef }>();
      let stale = false;

      for (const sp of site.systems) {
        try {
          const topoRaw = await this.library.load(sp.config) as SystemTopology;
          topoRaw.route_overrides ??= {};
          topoRaw.automations ??= [];
          const boardResult = await this.electron.boardLoad(topoRaw.device.board);
          const board = boardResult.board as BoardDef;
          systems.set(sp.config, { topology: topoRaw, board });

          const currentChecksum = await this.electron.siteConfigChecksum(sp.config);
          if (currentChecksum !== sp.checksum) {
            stale = true;
          }
        } catch {
          stale = true;
        }
      }

      // Run ID collision migration
      const { systems: migrated, dirtied } = this.migrateIds(systems, site);

      this._site.set(site);
      this._systems.set(migrated);
      this._stale.set(stale);
      this._dirtyConfigs.set(dirtied);
      this._siteDirty.set(dirtied.size > 0);
    } finally {
      this._loading.set(false);
    }
  }

  // --- Focus ---

  focusSystem(config: string): void {
    this._activeConfig.set(config);
  }

  unfocusSystem(): void {
    this._activeConfig.set(null);
  }

  // --- Topology mutations ---

  updateActiveTopology(updater: (t: SystemTopology) => void): void {
    const config = this._activeConfig();
    if (!config) return;
    this.updateSystemTopology(config, updater);
  }

  updateSystemTopology(config: string, updater: (t: SystemTopology) => void): void {
    const systems = this._systems();
    const entry = systems.get(config);
    if (!entry) return;
    const clone = structuredClone(entry.topology);
    updater(clone);
    const newSystems = new Map(systems);
    newSystems.set(config, { topology: clone, board: entry.board });
    this._systems.set(newSystems);
    this._dirtyConfigs.update(s => { const n = new Set(s); n.add(config); return n; });
  }

  // --- Site structure mutations ---

  updateSite(updater: (site: Site) => void): void {
    const site = this._site();
    if (!site) return;
    const copy = structuredClone(site);
    updater(copy);
    this._site.set(copy);
    this._siteDirty.set(true);
  }

  addLink(link: SiteLink): void {
    this.updateSite(s => s.links.push(link));
  }

  removeLink(linkId: string): void {
    this.updateSite(s => { s.links = s.links.filter(l => l.id !== linkId); });
  }

  /** Compute a position below all existing systems so the new one doesn't overlap. */
  nextSystemPosition(): { x: number; y: number } {
    const site = this._site();
    const systems = this._systems();
    if (!site || systems.size === 0) return { x: 0, y: 0 };

    let maxY = 0;
    for (const sp of site.systems) {
      const data = systems.get(sp.config);
      if (!data) continue;
      // Find the bottom edge of this system's nodes
      for (const node of data.topology.nodes) {
        const bottom = sp.position.y + node.position.y + 80; // 80 ≈ typical node height
        maxY = Math.max(maxY, bottom);
      }
    }
    return { x: 0, y: maxY + 40 };
  }

  async addSystem(configName: string, position: { x: number; y: number }): Promise<void> {
    const topoRaw = await this.library.load(configName) as SystemTopology;
    topoRaw.route_overrides ??= {};
    topoRaw.automations ??= [];
    const boardResult = await this.electron.boardLoad(topoRaw.device.board);
    const board = boardResult.board as BoardDef;
    const checksum = await this.electron.siteConfigChecksum(configName);

    // Migrate IDs if the new system collides with existing
    const tempSystems = new Map(this._systems());
    tempSystems.set(configName, { topology: topoRaw, board });
    const site = this._site();
    if (site) {
      const { systems: migrated, dirtied } = this.migrateIds(tempSystems, site);
      this._systems.set(migrated);
      if (dirtied.size > 0) {
        this._dirtyConfigs.update(s => { const n = new Set(s); for (const d of dirtied) n.add(d); return n; });
      }
    } else {
      this._systems.set(tempSystems);
    }

    this.updateSite(s => {
      s.systems.push({ config: configName, position, checksum });
    });
  }

  removeSystem(configName: string): void {
    const systems = new Map(this._systems());
    systems.delete(configName);
    this._systems.set(systems);

    this.updateSite(s => {
      s.systems = s.systems.filter(sp => sp.config !== configName);
      s.links = s.links.filter(l =>
        !l.from.startsWith(`${configName}/`) && !l.to.startsWith(`${configName}/`)
      );
    });

    this._dirtyConfigs.update(s => { const n = new Set(s); n.delete(configName); return n; });
  }

  // --- ID generation ---

  nextNodeId(kind: string): string {
    const allNodes = this.allNodes();
    const regex = new RegExp(`^${kind}(\\d+)$`);
    let max = 0;
    for (const node of allNodes) {
      if (node.kind !== kind) continue;
      const match = node.id.match(regex);
      if (match) max = Math.max(max, parseInt(match[1]));
      // Handle bare singleton IDs (e.g., 'water_source' counts as 1)
      if (node.id === kind) max = Math.max(max, 1);
    }
    return `${kind}${max + 1}`;
  }

  nextPipeId(): string {
    let max = 0;
    for (const [, { topology }] of this._systems()) {
      for (const p of topology.pipes) {
        const m = p.id.match(/^pipe(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return `pipe${max + 1}`;
  }

  // --- Save ---

  async saveSystem(config: string): Promise<void> {
    const entry = this._systems().get(config);
    if (!entry) return;
    await this.library.save(config, entry.topology);
    this._dirtyConfigs.update(s => { const n = new Set(s); n.delete(config); return n; });
  }

  async saveSite(): Promise<void> {
    const site = this._site();
    const name = this._siteName();
    if (!site || !name) return;

    // Save all dirty system topologies first
    for (const config of this._dirtyConfigs()) {
      const entry = this._systems().get(config);
      if (entry) await this.library.save(config, entry.topology);
    }

    // Recompute checksums
    for (const sp of site.systems) {
      try {
        sp.checksum = await this.electron.siteConfigChecksum(sp.config);
      } catch {
        sp.checksum = '';
      }
    }

    await this.electron.siteSave(name, site);
    this._dirtyConfigs.set(new Set());
    this._siteDirty.set(false);
    this._stale.set(false);
  }

  // --- Rebuild ---

  async rebuild(): Promise<void> {
    const site = this._site();
    if (!site) return;

    const systems = new Map<string, { topology: SystemTopology; board: BoardDef }>();
    const validConfigs = new Set<string>();

    for (const sp of site.systems) {
      try {
        const topoRaw = await this.library.load(sp.config) as SystemTopology;
        topoRaw.route_overrides ??= {};
        topoRaw.automations ??= [];
        const boardResult = await this.electron.boardLoad(topoRaw.device.board);
        const board = boardResult.board as BoardDef;
        systems.set(sp.config, { topology: topoRaw, board });
        validConfigs.add(sp.config);
      } catch {
        // System missing — will be removed
      }
    }

    // Migrate IDs after reload
    const { systems: migrated, dirtied } = this.migrateIds(systems, site);
    this._systems.set(migrated);

    this.updateSite(s => {
      s.systems = s.systems.filter(sp => validConfigs.has(sp.config));
      s.links = s.links.filter(l => {
        const fromConfig = l.from.split('/')[0];
        const toConfig = l.to.split('/')[0];
        return validConfigs.has(fromConfig) && validConfigs.has(toConfig);
      });
    });

    // Recompute checksums
    const site2 = this._site()!;
    for (const sp of site2.systems) {
      try {
        sp.checksum = await this.electron.siteConfigChecksum(sp.config);
      } catch {
        sp.checksum = '';
      }
    }
    this._site.set(structuredClone(site2));
    this._stale.set(false);
    this._dirtyConfigs.set(dirtied);
    this._siteDirty.set(true);
  }

  // --- Clear ---

  clear(): void {
    this._site.set(null);
    this._siteName.set(null);
    this._systems.set(new Map());
    this._activeConfig.set(null);
    this._dirtyConfigs.set(new Set());
    this._siteDirty.set(false);
    this._stale.set(false);
  }

  // --- ID collision migration ---

  private migrateIds(
    systems: Map<string, { topology: SystemTopology; board: BoardDef }>,
    site: Site,
  ): { systems: Map<string, { topology: SystemTopology; board: BoardDef }>; dirtied: Set<string> } {
    const seen = new Map<string, string>(); // nodeId → config that owns it
    const remaps = new Map<string, Map<string, string>>(); // config → oldId → newId
    const dirtied = new Set<string>();

    // Compute the max trailing number across all node IDs for each kind
    const kindMax = new Map<string, number>();
    for (const [, { topology }] of systems) {
      for (const node of topology.nodes) {
        const match = node.id.match(/^([a-z_]+?)(\d+)$/);
        if (match) {
          const kind = match[1];
          const num = parseInt(match[2]);
          kindMax.set(kind, Math.max(kindMax.get(kind) ?? 0, num));
        }
      }
    }

    // Detect collisions (first system to claim an ID keeps it)
    for (const [config, { topology }] of systems) {
      for (const node of topology.nodes) {
        if (seen.has(node.id)) {
          // Collision — renumber this node
          const remap = remaps.get(config) ?? new Map();
          const kind = node.kind;
          const next = (kindMax.get(kind) ?? 0) + 1;
          kindMax.set(kind, next);
          remap.set(node.id, `${kind}${next}`);
          remaps.set(config, remap);
        } else {
          seen.set(node.id, config);
        }
      }
    }

    if (remaps.size === 0) return { systems, dirtied };

    // Apply remaps
    const result = new Map<string, { topology: SystemTopology; board: BoardDef }>();
    for (const [config, entry] of systems) {
      const remap = remaps.get(config);
      if (!remap || remap.size === 0) {
        result.set(config, entry);
        continue;
      }

      dirtied.add(config);
      const topology = structuredClone(entry.topology);

      // Remap node IDs
      for (const node of topology.nodes) {
        const newId = remap.get(node.id);
        if (newId) node.id = newId;
      }

      // Remap pipe refs
      for (const pipe of topology.pipes) {
        pipe.from = remapPortRef(pipe.from, remap);
        pipe.to = remapPortRef(pipe.to, remap);
      }

      // Remap route_overrides keys
      if (topology.route_overrides) {
        const newOverrides: Record<string, RouteOverride> = {};
        for (const [key, value] of Object.entries(topology.route_overrides)) {
          newOverrides[remapRouteKey(key, remap)] = value;
        }
        topology.route_overrides = newOverrides;
      }

      // Remap automations
      for (const auto of (topology.automations ?? [])) {
        auto.route = remapRouteKey(auto.route, remap);
        if (auto.trigger.type === 'level' && (auto.trigger as any).node && remap.has((auto.trigger as any).node)) {
          (auto.trigger as any).node = remap.get((auto.trigger as any).node)!;
        }
      }

      result.set(config, { topology, board: entry.board });
    }

    // Remap site links
    for (const link of site.links) {
      try {
        const from = parseSiteLinkRef(link.from);
        const to = parseSiteLinkRef(link.to);
        const fromRemap = remaps.get(from.config);
        const toRemap = remaps.get(to.config);
        if (fromRemap?.has(from.nodeId)) {
          link.from = siteLinkRef(from.config, fromRemap.get(from.nodeId)!, from.portId);
        }
        if (toRemap?.has(to.nodeId)) {
          link.to = siteLinkRef(to.config, toRemap.get(to.nodeId)!, to.portId);
        }
      } catch {
        // Invalid link ref — skip
      }
    }

    return { systems: result, dirtied };
  }
}
