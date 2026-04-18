import { Injectable, signal, computed } from '@angular/core';
import { ElectronService } from './electron.service';
import type {
  SystemTopology, BoardDef, TopologyGraph, Route,
  TopologyNode, PipeSegment, RouteOverride,
  SiteMetadata, LinkData, StoredTopology, SiteSavePayload, SystemPayload,
} from '@far-mon/core';
import {
  boundaryPorts, buildCompositeGraph, deriveRoutes, activeGraph,
} from '@far-mon/core';
import type { BoundaryPort } from '@far-mon/core';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {

  // --- Core state ---
  private _site = signal<SiteMetadata | null>(null);
  private _systems = signal<Map<string, { topology: SystemTopology; board: BoardDef }>>(new Map());
  private _links = signal<LinkData[]>([]);
  private _activeSystemId = signal<string | null>(null);
  private _dirty = signal(false);
  private _dirtySystemIds = signal<Set<string>>(new Set());
  private _loading = signal(false);

  // --- Public readonly signals ---
  readonly site = this._site.asReadonly();
  readonly systems = this._systems.asReadonly();
  readonly links = this._links.asReadonly();
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
    const links = this._links();
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
        const conn = node.kind === 'interconnect' ? interconnectConn.get(nsId) : undefined;
        allNodes.push({
          ...node,
          id: nsId,
          position: {
            x: node.position.x + offset.x,
            y: node.position.y + offset.y,
          },
          ...(conn ? { _connectionLabel: conn.label, _connectionDir: conn.dir } : {}),
        } as TopologyNode);
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
    for (const link of this._links()) {
      allPipes.push({
        id: `link-${link.id}`,
        from: `${link.fromSystem}/${link.fromNode}:${link.fromPort}`,
        to: `${link.toSystem}/${link.toNode}:${link.toPort}`,
      });
    }

    return {
      schema: 10,
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
    const links = this._links();
    if (!site || systems.size === 0) return null;

    const inputs = [...systems.entries()].map(([systemId, { topology }]) => ({
      systemId,
      topology,
    }));

    return buildCompositeGraph(inputs, links);
  });

  readonly compositeRoutes = computed<Route[]>(() => {
    const graph = this.compositeGraph();
    if (!graph) return [];
    return deriveRoutes(activeGraph(graph));
  });

  readonly boundaryPortsBySystem = computed<Map<string, BoundaryPort[]>>(() => {
    const systems = this._systems();
    const result = new Map<string, BoundaryPort[]>();
    for (const [systemId, { topology }] of systems) {
      result.set(systemId, boundaryPorts(topology));
    }
    return result;
  });

  readonly brokenLinks = computed<LinkData[]>(() => {
    const systems = this._systems();
    const links = this._links();
    return links.filter(link =>
      !systems.has(link.fromSystem) || !systems.has(link.toSystem)
    );
  });

  readonly unlinkedInterconnects = computed<Array<{ systemId: string; nodeId: string; nodeName: string }>>(() => {
    const systems = this._systems();
    const links = this._links();

    const linkedNodeIds = new Set<string>();
    for (const link of links) {
      linkedNodeIds.add(`${link.fromSystem}/${link.fromNode}`);
      linkedNodeIds.add(`${link.toSystem}/${link.toNode}`);
    }

    const result: Array<{ systemId: string; nodeId: string; nodeName: string }> = [];
    for (const [systemId, { topology }] of systems) {
      for (const node of topology.nodes) {
        if (node.kind === 'interconnect' && !linkedNodeIds.has(`${systemId}/${node.id}`)) {
          result.push({ systemId, nodeId: node.id, nodeName: (node as any).name ?? node.id });
        }
      }
    }
    return result;
  });

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
          // Reconstruct full SystemTopology from stored parts
          const topology = this.reconstructTopology(sp);

          const boardResult = await this.electron.boardLoad(sp.board);
          const board = boardResult.board as BoardDef;

          systems.set(sp.id, { topology, board });
        } catch {
          // Skip systems with broken board references
        }
      }

      this._systems.set(systems);
      this._links.set(payload.links);
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

  addLink(link: LinkData): void {
    this._links.update(links => [...links, link]);
    this._dirtySystemIds.update(s => { const n = new Set(s); n.add(link.fromSystem); n.add(link.toSystem); return n; });
    this._dirty.set(true);
  }

  removeLink(linkId: string): void {
    const link = this._links().find(l => l.id === linkId);
    this._links.update(links => links.filter(l => l.id !== linkId));
    if (link) {
      this._dirtySystemIds.update(s => { const n = new Set(s); n.add(link.fromSystem); n.add(link.toSystem); return n; });
    }
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

    // Remove links referencing this system
    this._links.update(links =>
      links.filter(l => l.fromSystem !== systemId && l.toSystem !== systemId)
    );

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

    const systemPayloads: SiteSavePayload['systems'] = [];
    for (const [systemId, { topology }] of this._systems()) {
      systemPayloads.push({
        id: systemId,
        friendlyName: topology.device.friendly_name,
        board: topology.device.board,
        directory: topology.device.directory ?? null,
        topology: {
          nodes: topology.nodes,
          pipes: topology.pipes,
          route_overrides: topology.route_overrides,
          timing: topology.timing,
          automations: topology.automations,
          uart_buses: topology.device.uart_buses,
          io_providers: topology.device.io_providers,
          network: topology.device.network,
        },
        deviceName: topology.device.name,
      });
    }

    const payload: SiteSavePayload = {
      site: { id: site.id, friendlyName: site.friendlyName },
      systems: systemPayloads,
      links: this._links(),
    };

    await this.electron.siteSave(payload);
    this._dirty.set(false);
    this._dirtySystemIds.set(new Set());
  }

  // --- Clear ---

  clear(): void {
    this._site.set(null);
    this._systems.set(new Map());
    this._links.set([]);
    this._activeSystemId.set(null);
    this._dirtySystemIds.set(new Set());
    this._dirty.set(false);
    this._loading.set(false);
  }

  // --- Helpers ---

  private reconstructTopology(sp: SystemPayload): SystemTopology {
    const topo = sp.topology;
    return {
      schema: 10,
      device: {
        name: sp.deviceName || sp.id,
        friendly_name: sp.friendlyName,
        board: sp.board,
        directory: sp.directory ?? undefined,
        uart_buses: topo.uart_buses,
        io_providers: topo.io_providers,
        network: topo.network,
      },
      nodes: topo.nodes ?? [],
      pipes: topo.pipes ?? [],
      route_overrides: topo.route_overrides ?? {},
      timing: topo.timing ?? {
        valve_travel_time: '2s',
        flow_watchdog_seconds: 30,
        flow_confirm_seconds: 5,
        api_watchdog_seconds: 300,
        update_interval: '10s',
      },
      automations: topo.automations ?? [],
    };
  }
}
