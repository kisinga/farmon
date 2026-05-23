import { Injectable, signal, computed } from '@angular/core';
import { ElectronService } from './electron.service';
import type {
  BoardDef, TopologyGraph, Route,
  TopologyNode, PipeSegment, RouteOverride,
  SiteMetadata, SiteSavePayload,
} from '@far-mon/core';
import type { SystemTopology } from '../models/topology.model';
import type { SystemPayload } from '../models/electron-api';
import {
  buildGraph, deriveRoutes, activeGraph, parseTopology,
} from '@far-mon/core';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {

  // --- Core state ---
  private _site = signal<SiteMetadata | null>(null);
  // TODO(anchor-mesh): transition from per-system Map to flat SiteTopology
  private _systems = signal<Map<string, { topology: SystemTopology; board: BoardDef }>>(new Map());
  private _activeSystemId = signal<string | null>(null);
  private _dirty = signal(false);
  private _dirtySystemIds = signal<Set<string>>(new Set());
  private _loading = signal(false);

  // --- Public readonly signals ---
  readonly site = this._site.asReadonly();
  readonly systems = this._systems.asReadonly();
  // TODO(anchor-mesh): links removed in SiteTopology; keep empty for UI compat
  readonly links = computed<unknown[]>(() => []);
  readonly activeSystemId = this._activeSystemId.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly dirtySystemIds = this._dirtySystemIds.asReadonly();
  readonly loading = this._loading.asReadonly();

  // --- Active system computed signals ---

  readonly activeTopology = computed<SystemTopology | null>(() => {
    const id = this._activeSystemId();
    if (!id) return null;
    return this._systems().get(id)?.topology ?? null;
  });

  readonly activeBoard = computed<BoardDef | null>(() => {
    const id = this._activeSystemId();
    if (!id) return null;
    return this._systems().get(id)?.board ?? null;
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

    // Build interconnect connection map: "systemId/nodeId" → { label, dir }
    const links: any[] = [];
    const interconnectConn = new Map<string, { label: string; dir: 'out' | 'in' }>();
    for (const link of links) {
      const toName = systems.get(link.toSystem)?.topology.device.friendly_name ?? link.toSystem;
      const fromName = systems.get(link.fromSystem)?.topology.device.friendly_name ?? link.fromSystem;
      interconnectConn.set(`${link.fromSystem}/${link.fromNode}`, { label: toName, dir: 'out' });
      interconnectConn.set(`${link.toSystem}/${link.toNode}`, { label: fromName, dir: 'in' });
    }

    // Compute non-overlapping vertical layout from actual node bounding boxes
    // Gap = boundary padding (top + bottom) + label height + visual breathing room
    const SYSTEM_GAP = 30 * 2 + 24 + 20; // BOUNDARY_PADDING*2 + LABEL_HEIGHT + spacing
    let nextY = 0;
    const systemOffsets = new Map<string, { x: number; y: number }>();

    for (const [systemId, { topology }] of systems) {
      if (topology.nodes.length === 0) {
        systemOffsets.set(systemId, { x: 0, y: nextY });
        nextY += SYSTEM_GAP;
        continue;
      }

      // Find bounding box of nodes within this system
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of topology.nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + 120); // approximate node width
        maxY = Math.max(maxY, node.position.y + 60);  // approximate node height
      }

      // Offset so system's top-left starts at (0, nextY), normalized
      const offsetX = -minX;
      const offsetY = nextY - minY;
      systemOffsets.set(systemId, { x: offsetX, y: offsetY });
      nextY += (maxY - minY) + SYSTEM_GAP;
    }

    for (const [systemId, { topology }] of systems) {
      const offset = systemOffsets.get(systemId)!;
      for (const node of topology.nodes) {
        const nsId = `${systemId}/${node.id}`;
        allNodes.push({
          ...node,
          id: nsId,
          position: {
            x: node.position.x + offset.x,
            y: node.position.y + offset.y,
          },
        });
      }
      for (const pipe of topology.pipes) {
        const [fromNode, fromPort] = pipe.from.split(':');
        const [toNode, toPort] = pipe.to.split(':');
        allPipes.push({
          id: `${systemId}/${pipe.id}`,
          from: `${systemId}/${fromNode}:${fromPort}`,
          to: `${systemId}/${toNode}:${toPort}`,
        });
      }
    }

    // Add inter-system links as pipes
    for (const link of links) {
      allPipes.push({
        id: `link-${link.id}`,
        from: `${link.fromSystem}/${link.fromNode}:${link.fromPort}`,
        to: `${link.toSystem}/${link.toNode}:${link.toPort}`,
      });
    }

    return {
      schema: 14,
      device: { name: 'composite', friendly_name: 'Site', board: '' },
      nodes: allNodes,
      pipes: allPipes,
      route_overrides: {},
      timing: {
        valve_travel_time: 0,
        flow_watchdog: 0,
        flow_confirm: 0,
        flow_threshold: 0,
        api_watchdog: 0,
        update_interval: 0,
      },
      automations: [],
    };
  });

  // --- Composite graph (for cross-system route derivation) ---

  readonly compositeGraph = computed<TopologyGraph | null>(() => {
    const topo = this.compositeTopology();
    if (!topo) return null;
    return buildGraph(topo.nodes, topo.pipes);
  });

  readonly compositeRoutes = computed<Route[]>(() => {
    const graph = this.compositeGraph();
    if (!graph) return [];
    return deriveRoutes(activeGraph(graph));
  });

  // TODO(anchor-mesh): boundaryPorts removed; return empty for UI compat
  readonly boundaryPortsBySystem = computed<Map<string, any[]>>(() => new Map());

  // TODO(anchor-mesh): links removed in SiteTopology
  readonly brokenLinks = computed<unknown[]>(() => []);

  // TODO(anchor-mesh): interconnect nodes removed in SiteTopology
  readonly unlinkedInterconnects = computed<Array<{ systemId: string; nodeId: string; nodeName: string }>>(() => []);

  constructor(private electron: ElectronService) {}

  // --- Load ---

  async load(siteId: string): Promise<void> {
    this.clear();
    this._loading.set(true);

    try {
      const payload = await this.electron.siteLoad(siteId);
      this._site.set({ id: payload.site.id, friendlyName: payload.site.friendlyName });

      const systems = new Map<string, { topology: SystemTopology; board: BoardDef }>();

      for (const sp of payload.systems) {
        try {
          // Reconstruct full topology from stored parts
          const topology = this.reconstructTopology(sp);

          const boardResult = await this.electron.boardLoad(sp.board);
          const board = boardResult.board as BoardDef;

          systems.set(sp.id, { topology, board });
        } catch (err) {
          // Skip systems with broken board references
          console.error(`[Workspace] Failed to load system "${sp.id}":`, err);
        }
      }

      this._systems.set(systems);
      this._dirty.set(false);
    } finally {
      this._loading.set(false);
    }
  }

  // --- Focus ---

  focusSystem(systemId: string): void {
    this._activeSystemId.set(systemId);
  }

  unfocusSystem(): void {
    this._activeSystemId.set(null);
  }

  // --- Topology mutations ---

  updateActiveTopology(updater: (t: SystemTopology) => void): void {
    const id = this._activeSystemId();
    if (!id) return;
    this.updateSystemTopology(id, updater);
  }

  /** Atomically swap the board for the active system, updating both the BoardDef and topology.device.board. */
  changeActiveBoard(board: BoardDef): void {
    const id = this._activeSystemId();
    if (!id) return;
    const systems = this._systems();
    const entry = systems.get(id);
    if (!entry) return;
    const clone = structuredClone(entry.topology);
    clone.device.board = board.model;
    const newSystems = new Map(systems);
    newSystems.set(id, { topology: clone, board });
    this._systems.set(newSystems);
    this._dirtySystemIds.update(s => new Set(s).add(id));
    this._dirty.set(true);
  }

  updateSystemTopology(systemId: string, updater: (t: SystemTopology) => void): void {
    const systems = this._systems();
    const entry = systems.get(systemId);
    if (!entry) return;
    const clone = structuredClone(entry.topology);
    updater(clone);
    const newSystems = new Map(systems);
    newSystems.set(systemId, { topology: clone, board: entry.board });
    this._systems.set(newSystems);
    this._dirtySystemIds.update(s => new Set(s).add(systemId));
    this._dirty.set(true);
  }

  // --- Site metadata mutations ---

  updateSiteName(friendlyName: string): void {
    const site = this._site();
    if (!site) return;
    this._site.set({ ...site, friendlyName });
    this._dirty.set(true);
  }

  // --- Link mutations ---

  // TODO(anchor-mesh): links removed in SiteTopology; keep no-op for UI compat
  addLink(link: any): void {
    this._dirty.set(true);
  }

  removeLink(linkId: string): void {
    this._dirty.set(true);
  }

  // --- System management ---

  async addSystemFromTemplate(templateName: string): Promise<string> {
    const site = this._site();
    if (!site) throw new Error('No site loaded');

    const systemPayload = await this.electron.systemAddFromTemplate(site.id, templateName);

    // Load board for the new system
    const boardResult = await this.electron.boardLoad(systemPayload.board);
    const board = boardResult.board as BoardDef;
    const topology = this.reconstructTopology(systemPayload);

    const newSystems = new Map(this._systems());
    newSystems.set(systemPayload.id, { topology, board });
    this._systems.set(newSystems);
    this._dirtySystemIds.update(s => new Set(s).add(systemPayload.id));
    this._dirty.set(true);

    return systemPayload.id;
  }

  removeSystem(systemId: string): void {
    const systems = new Map(this._systems());
    systems.delete(systemId);
    this._systems.set(systems);

    this._dirtySystemIds.update(s => { const n = new Set(s); n.delete(systemId); return n; });

    this._dirty.set(true);
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
    let max = 0;
    for (const [, { topology }] of this._systems()) {
      for (const p of topology.pipes) {
        const m = p.id.match(/^pipe(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return `pipe${max + 1}`;
  }

  // --- Save (atomic) ---

  async save(): Promise<void> {
    const site = this._site();
    if (!site) return;

    const systemPayloads: SystemPayload[] = [];
    for (const [systemId, { topology }] of this._systems()) {
      systemPayloads.push({
        id: systemId,
        friendlyName: topology.device.friendly_name,
        board: topology.device.board,
        directory: topology.device.directory ?? null,
        topology: {
          nodes: topology.nodes as unknown[],
          pipes: topology.pipes as unknown[],
          route_overrides: topology.route_overrides as Record<string, unknown>,
          timing: topology.timing as unknown,
          automations: topology.automations as unknown[],
          uart_buses: topology.device.uart_buses as unknown[] | undefined,
          io_providers: topology.device.io_providers as unknown[] | undefined,
          network: topology.device.network as unknown,
        },
        deviceName: topology.device.name,
      });
    }

    const payload: any = {
      site: { id: site.id, friendlyName: site.friendlyName },
      systems: systemPayloads,
      links: [],
    };

    await this.electron.siteSave(payload);
    this._dirty.set(false);
    this._dirtySystemIds.set(new Set());
  }

  // --- Clear ---

  clear(): void {
    this._site.set(null);
    this._systems.set(new Map());
    this._activeSystemId.set(null);
    this._dirtySystemIds.set(new Set());
    this._dirty.set(false);
    this._loading.set(false);
  }

  // --- Helpers ---

  private reconstructTopology(sp: SystemPayload): any {
    const topo = sp.topology as Record<string, unknown>;
    const parsed = parseTopology({
      schema: 14,
      device: {
        name: sp.deviceName || sp.id,
        friendly_name: sp.friendlyName,
        board: sp.board,
        directory: sp.directory ?? undefined,
        uart_buses: topo['uart_buses'],
        io_providers: topo['io_providers'],
        network: topo['network'],
      },
      nodes: topo['nodes'],
      pipes: topo['pipes'],
      route_overrides: topo['route_overrides'],
      timing: topo['timing'],
      automations: topo['automations'],
    });
    // Frontend still expects legacy SystemTopology shape with `device` field.
    // Add it back for compatibility during the anchor-mesh transition.
    return {
      ...parsed,
      device: {
        name: sp.deviceName || sp.id,
        friendly_name: sp.friendlyName,
        board: sp.board,
        directory: sp.directory ?? undefined,
        uart_buses: topo['uart_buses'],
        io_providers: topo['io_providers'],
        network: topo['network'],
      },
    };
  }
}
