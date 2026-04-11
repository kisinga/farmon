import { Injectable, signal, computed } from '@angular/core';
import { ElectronService } from './electron.service';
import { LibraryService } from './library.service';
import { BoardService } from './board.service';
import type { SystemTopology, BoardDef, Site, SiteLink, BoundaryPort, TopologyGraph, Route } from '@far-mon/core';
import { parseSite, boundaryPorts, buildCompositeGraph, deriveRoutes, activeGraph, buildGraph } from '@far-mon/core';

@Injectable({ providedIn: 'root' })
export class SiteEditorService {

  // --- Core state ---
  private _site = signal<Site | null>(null);
  private _siteName = signal<string | null>(null);
  private _dirty = signal(false);
  private _stale = signal(false);

  readonly site = this._site.asReadonly();
  readonly siteName = this._siteName.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  /** True when any system's checksum doesn't match — rebuild required. */
  readonly stale = this._stale.asReadonly();

  // --- Loaded systems (populated on site load) ---
  private _loadedSystems = signal<Map<string, { topology: SystemTopology; board: BoardDef }>>(new Map());
  readonly loadedSystems = this._loadedSystems.asReadonly();

  // --- Composite graph (derived from all systems + links) ---
  readonly compositeGraph = computed<TopologyGraph | null>(() => {
    const site = this._site();
    const systems = this._loadedSystems();
    if (!site || systems.size === 0) return null;

    const inputs = site.systems
      .filter(sp => systems.has(sp.config))
      .map(sp => ({
        configName: sp.config,
        topology: systems.get(sp.config)!.topology,
      }));

    return buildCompositeGraph(inputs, site.links);
  });

  /** Cross-system routes derived from the composite graph. */
  readonly compositeRoutes = computed<Route[]>(() => {
    const graph = this.compositeGraph();
    if (!graph) return [];
    return deriveRoutes(activeGraph(graph));
  });

  /** Boundary ports per system — available for inter-system linking. */
  readonly boundaryPortsBySystem = computed<Map<string, BoundaryPort[]>>(() => {
    const systems = this._loadedSystems();
    const result = new Map<string, BoundaryPort[]>();
    for (const [config, { topology }] of systems) {
      result.set(config, boundaryPorts(topology));
    }
    return result;
  });

  /** Links that reference missing nodes/ports. */
  readonly brokenLinks = computed<SiteLink[]>(() => {
    const site = this._site();
    const systems = this._loadedSystems();
    if (!site) return [];

    return site.links.filter(link => {
      try {
        const fromParts = link.from.split('/');
        const toParts = link.to.split('/');
        const fromConfig = fromParts[0];
        const toConfig = toParts[0];
        return !systems.has(fromConfig) || !systems.has(toConfig);
      } catch {
        return true;
      }
    });
  });

  constructor(
    private electron: ElectronService,
    private library: LibraryService,
    private boardService: BoardService,
  ) {}

  // --- Load ---

  async load(siteName: string): Promise<void> {
    const raw = await this.electron.siteLoad(siteName);
    const site = parseSite(raw);

    // Load all referenced system topologies
    const systems = new Map<string, { topology: SystemTopology; board: BoardDef }>();
    let stale = false;

    for (const sp of site.systems) {
      try {
        const topoRaw = await this.library.load(sp.config) as SystemTopology;
        const boardResult = await this.electron.boardLoad(topoRaw.device.board);
        const board = boardResult.board as BoardDef;
        systems.set(sp.config, { topology: topoRaw, board });

        // Check checksum
        const currentChecksum = await this.electron.siteConfigChecksum(sp.config);
        if (currentChecksum !== sp.checksum) {
          stale = true;
        }
      } catch {
        // System config missing or failed to load
        stale = true;
      }
    }

    this._site.set(site);
    this._siteName.set(siteName);
    this._loadedSystems.set(systems);
    this._stale.set(stale);
    this._dirty.set(false);
  }

  // --- Mutations ---

  updateSite(updater: (site: Site) => void): void {
    const site = this._site();
    if (!site) return;
    const copy = structuredClone(site);
    updater(copy);
    this._site.set(copy);
    this._dirty.set(true);
  }

  addLink(link: SiteLink): void {
    this.updateSite(s => s.links.push(link));
  }

  removeLink(linkId: string): void {
    this.updateSite(s => {
      s.links = s.links.filter(l => l.id !== linkId);
    });
  }

  async addSystem(configName: string, position: { x: number; y: number }): Promise<void> {
    const topoRaw = await this.library.load(configName) as SystemTopology;
    const boardResult = await this.electron.boardLoad(topoRaw.device.board);
    const board = boardResult.board as BoardDef;
    const checksum = await this.electron.siteConfigChecksum(configName);

    // Update loaded systems
    const systems = new Map(this._loadedSystems());
    systems.set(configName, { topology: topoRaw, board });
    this._loadedSystems.set(systems);

    this.updateSite(s => {
      s.systems.push({ config: configName, position, checksum });
    });
  }

  removeSystem(configName: string): void {
    // Remove system and any links referencing it
    const systems = new Map(this._loadedSystems());
    systems.delete(configName);
    this._loadedSystems.set(systems);

    this.updateSite(s => {
      s.systems = s.systems.filter(sp => sp.config !== configName);
      s.links = s.links.filter(l =>
        !l.from.startsWith(`${configName}/`) && !l.to.startsWith(`${configName}/`)
      );
    });
  }

  /** Rebuild: recompute checksums, validate links, drop broken ones. */
  async rebuild(): Promise<void> {
    const site = this._site();
    if (!site) return;

    // Reload all systems
    const systems = new Map<string, { topology: SystemTopology; board: BoardDef }>();
    const validConfigs = new Set<string>();

    for (const sp of site.systems) {
      try {
        const topoRaw = await this.library.load(sp.config) as SystemTopology;
        const boardResult = await this.electron.boardLoad(topoRaw.device.board);
        const board = boardResult.board as BoardDef;
        systems.set(sp.config, { topology: topoRaw, board });
        validConfigs.add(sp.config);
      } catch {
        // System missing — will be removed
      }
    }

    this._loadedSystems.set(systems);

    // Update site: remove missing systems, update checksums, validate links
    this.updateSite(s => {
      // Remove systems that failed to load
      s.systems = s.systems.filter(sp => validConfigs.has(sp.config));

      // Update checksums (we'll compute them after)
      // Remove links referencing missing systems
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
    this._dirty.set(true);
  }

  // --- Save ---

  async save(): Promise<void> {
    const site = this._site();
    const name = this._siteName();
    if (!site || !name) return;

    // Recompute checksums before saving
    for (const sp of site.systems) {
      try {
        sp.checksum = await this.electron.siteConfigChecksum(sp.config);
      } catch {
        sp.checksum = '';
      }
    }

    await this.electron.siteSave(name, site);
    this._dirty.set(false);
    this._stale.set(false);
  }

  // --- Clear ---

  clear(): void {
    this._site.set(null);
    this._siteName.set(null);
    this._loadedSystems.set(new Map());
    this._dirty.set(false);
    this._stale.set(false);
  }
}
