import { Injectable, inject, signal, computed } from '@angular/core';
import type { PinCap, BoardDef } from '../models/board.model';
import { reservedPins, exposedPins } from '../models/board.model';
import type { ValidationResult, RuleDiagnostic, GenerateResult } from '../models/backend-api';
import type { Controller, SiteTopology } from '@core';
import type { IoProviderDef } from '@core';
import { collectPins, NODE_REGISTRY, createBoardDriver, buildProviderDrivers, slug } from '@core';
import type { IoProviderDriver } from '@core';
import { WorkspaceService } from './workspace.service';
import { BoardService } from './board.service';

/** The selectable aspect panels of the site workspace. */
export type EditorPanel = 'site' | 'design' | 'remotes' | 'config' | 'deploy';

/** Plain-language label per panel — the single source the rail + breadcrumb share. */
export const PANEL_LABELS: Record<EditorPanel, string> = {
  site: 'Overview',
  design: 'Design',
  config: 'Config',
  remotes: 'Sharing',
  deploy: 'Firmware',
};

/**
 * URL slug for each controller-scoped panel. Overview ('site') is site-wide and
 * has no slug — it lives at the bare `/site/:name`. These map a panel to the
 * `:section` segment of `/site/:name/system/:config/:section`, so each section is
 * a real, bookmarkable browser link.
 */
export const PANEL_SLUGS: Record<Exclude<EditorPanel, 'site'>, string> = {
  design: 'design',
  config: 'config',
  remotes: 'sharing',
  deploy: 'firmware',
};

/** Inverse of {@link PANEL_SLUGS}: a URL `:section` slug → the panel it selects.
 *  The legacy `schedules` slug is intentionally absent — it now falls back to
 *  'design' (automations moved to the operator /automations page). */
export const SLUG_PANELS: Record<string, EditorPanel> = {
  design: 'design',
  config: 'config',
  sharing: 'remotes',
  firmware: 'deploy',
};

@Injectable({ providedIn: 'root' })
export class SystemEditorService {
  private workspace = inject(WorkspaceService);
  private boardCatalog = inject(BoardService);

  // --- Session-specific state (NOT in workspace) ---
  /** Route-level preview (read-only embed). Distinct from the commissioned lock. */
  private _readonly = signal(false);
  /** Sites the admin opted into editing this session, by id. Per-site so unlocking one
   *  live site never unlocks another, and (unlike the old single flag) it survives
   *  navigating away from and back to the editor — it resets only on a full reload, which
   *  re-locks commissioned sites by design. */
  private _unlockedSites = signal<ReadonlySet<string>>(new Set());
  private _validation = signal<ValidationResult | null>(null);
  private _generatedFiles = signal<GenerateResult | null>(null);
  private _canvasSvg = signal<string | null>(null);

  /** Active workspace panel. The "design" canvas stays mounted regardless. */
  readonly panel = signal<EditorPanel>('design');

  // --- Delegated reads from workspace ---
  readonly topology = this.workspace.activeTopology;
  readonly board = this.workspace.activeBoard;
  readonly controllerId = this.workspace.activeControllerId;

  /** Whether the site is commissioned but the admin hasn't entered design mode. */
  readonly locked = computed(() => {
    const siteId = this.workspace.site()?.id;
    return this.workspace.commissioned() && (!siteId || !this._unlockedSites().has(siteId));
  });

  /** True design is read-only: route preview OR an unbroken commissioned lock. */
  readonly readonly = computed(() => this._readonly() || this.locked());

  /** Admin has lifted the lock for the active site this session. */
  readonly designUnlocked = computed(() => {
    const siteId = this.workspace.site()?.id;
    return !!siteId && this._unlockedSites().has(siteId);
  });

  /** Admin opts into editing the active commissioned site (lifts its lock this session). */
  enterDesignMode(): void {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;
    this._unlockedSites.update(s => new Set(s).add(siteId));
  }

  // --- Active controller computed ---
  readonly activeController = computed(() => {
    const topology = this.workspace.siteTopology();
    const cid = this.controllerId();
    if (!topology || !cid) return null;
    return topology.controllers.find(c => c.id === cid) ?? null;
  });

  /** Transient device projection for template convenience. Not a source of truth. */
  readonly controllerDevice = computed(() => {
    const ctrl = this.activeController();
    if (!ctrl) return null;
    return {
      name: slug(ctrl.friendlyName ?? ctrl.id),
      friendly_name: ctrl.friendlyName ?? ctrl.id,
      board: ctrl.board,
      directory: ctrl.directory,
      network: ctrl.network,
      uart_buses: ctrl.uart_buses,
      io_providers: ctrl.io_providers,
    };
  });

  // --- Transport-agnostic channel computeds ---

  /** All driver instances — board is just another driver. */
  private readonly drivers = computed(() => {
    const board = this.board();
    const controller = this.activeController();
    if (!board || !controller) return [];
    return this._buildDrivers(
      board,
      controller.io_providers ?? [],
    );
  });

  readonly reservedPins = computed(() => {
    const b = this.board();
    const reserved = b ? reservedPins(b) : new Map<string, string>();
    // Add pins consumed by I/O provider infrastructure
    for (const { id, driver } of this.drivers()) {
      if (id === 'board') continue;
      for (const pin of driver.consumedPins?.() ?? []) {
        reserved.set(pin, `${id} infrastructure`);
      }
    }
    return reserved;
  });

  readonly exposedPins = computed(() => {
    const b = this.board();
    return b ? exposedPins(b) : new Set<string>();
  });

  readonly pinUsages = computed(() => {
    const t = this.topology();
    return t ? collectPins(t.nodes) : [];
  });

  readonly usedPins = computed(() => {
    const map = new Map<string, string>();
    for (const u of this.pinUsages()) {
      map.set(u.pin, u.owner);
    }
    return map;
  });

  /** Pin usages (with node kind) for the ACTIVE controller — drives the board pinout callouts. */
  readonly activePinUsages = computed(() => {
    const cid = this.controllerId();
    const topology = this.workspace.siteTopology();
    if (!cid || !topology) return [];
    return collectPins(topology.nodes.filter(n => n.anchorId === cid));
  });

  /** Pins used by nodes belonging to a SPECIFIC controller only. */
  usedPinsForController(controllerId: string): Map<string, string> {
    const topology = this.workspace.siteTopology();
    if (!topology) return new Map();
    const nodes = topology.nodes.filter(n => n.anchorId === controllerId);
    return new Map(collectPins(nodes).map(u => [u.pin, u.owner]));
  }

  readonly boardPins = computed(() => {
    const b = this.board();
    return b ? b.pins : [];
  });

  /** Enumerate channels from ALL drivers (board + providers), filtered by capability. */
  availableChannels(cap?: PinCap): Array<{
    id: string; label: string; caps: PinCap[];
    provider: string; providerLabel: string; usedBy?: string;
  }> {
    const board = this.board();
    const topology = this.topology();
    if (!board) return [];
    const drivers = this.drivers();
    const reserved = this.reservedPins();
    return this._enumerateChannels(drivers, this.usedPins(), reserved, cap);
  }

  /** Group channels by provider for two-step selector. */
  channelGroups(cap?: PinCap): Array<{ provider: string; label: string; channels: Array<{
    id: string; label: string; caps: PinCap[]; usedBy?: string;
  }> }> {
    const board = this.board();
    const controller = this.activeController();
    if (!board || !controller) return [];
    return this._channelGroups(
      board,
      controller.io_providers ?? [],
      this.usedPins(),
      cap,
    );
  }

  /**
   * Channel groups for a SPECIFIC controller — not just the active one.
   * The sidebar uses this so pin selection reflects the node's assigned
   * controller, even when the editor is focused on a different one.
   */
  channelGroupsForController(controllerId: string, cap?: PinCap): Array<{ provider: string; label: string; channels: Array<{
    id: string; label: string; caps: PinCap[]; usedBy?: string;
  }> }> {
    const boards = this.workspace.boards();
    const board = boards.get(controllerId);
    if (!board) return [];

    const topology = this.workspace.siteTopology();
    const controller = topology?.controllers.find(c => c.id === controllerId);
    return this._channelGroups(
      board,
      controller?.io_providers ?? [],
      this.usedPinsForController(controllerId),
      cap,
    );
  }

  readonly gpioUsage = computed(() => {
    const used = this.usedPins().size;
    const total = this.exposedPins().size;
    return { used, total, percent: total > 0 ? Math.round((used / total) * 100) : 0 };
  });

  // --- Validation ---
  readonly validation = this._validation.asReadonly();

  readonly diagnostics = computed(() => {
    return this._validation()?.diagnostics ?? [];
  });

  readonly diagnosticsByTarget = computed(() => {
    const map = new Map<string, RuleDiagnostic[]>();
    for (const d of this.diagnostics()) {
      const key = d.target ?? '';
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return map;
  });

  // --- Generated output ---
  readonly generatedFiles = this._generatedFiles.asReadonly();

  // --- Canvas snapshot ---
  readonly canvasSvg = this._canvasSvg.asReadonly();

  // --- Actions ---

  /** Focus on a controller for editing. Workspace must already have it loaded. */
  focus(controllerId: string, opts?: { readonly?: boolean }): void {
    this.workspace.focusController(controllerId);
    this._readonly.set(opts?.readonly ?? false);
    this._validation.set(null);
    this._generatedFiles.set(null);
    this._canvasSvg.set(null);
  }

  /** Mutate the active system's topology. Marks workspace dirty. */
  updateTopology(updater: (t: SiteTopology) => void): void {
    if (this.readonly()) return;
    this.workspace.updateSiteTopology(updater);
  }

  /** Mutate the active controller's device fields. */
  updateActiveController(updater: (ctrl: Controller) => void): void {
    if (this.readonly()) return;
    const cid = this.controllerId();
    if (!cid) return;
    this.workspace.updateController(cid, updater);
  }

  /** Atomically swap the board for the active system. */
  changeBoard(board: BoardDef): void {
    if (this.readonly()) return;
    this.workspace.changeActiveBoard(board);
  }

  setValidation(result: ValidationResult): void {
    this._validation.set(result);
  }

  /** Capture the current canvas as an SVG string. */
  setCanvasSvg(svg: string): void {
    if (svg && svg.includes('<svg')) {
      this._canvasSvg.set(svg);
    }
  }

  setGenerateResult(result: GenerateResult): void {
    this._generatedFiles.set(result);
  }

  /** Generate a site-wide unique node ID via workspace. */
  nextNodeId(kind: string): string {
    return this.workspace.nextNodeId(kind);
  }

  /** Generate a site-wide unique pipe ID via workspace. */
  nextPipeId(): string {
    return this.workspace.nextPipeId();
  }

  /** Clear all pin assignments across every node in the topology. */
  clearAllPins(): void {
    this.updateTopology((t) => {
      for (const node of t.nodes) {
        const desc = NODE_REGISTRY.get(node.kind);
        if (!desc) continue;
        for (const field of desc.sidebarFields) {
          if (field.type !== 'pin') continue;
          (node as Record<string, unknown>)[field.key] = '';
        }
      }
    });
  }

  clear(): void {
    this.workspace.unfocusController();
    this._readonly.set(false);
    // Design-unlock is deliberately NOT cleared here: it's per-site session state that must
    // survive navigating away from and back to the editor (it resets only on a full reload).
    this._validation.set(null);
    this._generatedFiles.set(null);
    this._canvasSvg.set(null);
  }

  // ---------------------------------------------------------------------------
  // Private helpers — shared between active-controller and parameterized paths
  // ---------------------------------------------------------------------------

  /** Build driver list for a given board + I/O providers. */
  private _buildDrivers(
    board: BoardDef,
    ioProviders: IoProviderDef[],
  ): Array<{ id: string; label: string; driver: IoProviderDriver }> {
    const result: Array<{ id: string; label: string; driver: IoProviderDriver }> = [
      { id: 'board', label: 'Board', driver: createBoardDriver(board) },
    ];
    try {
      for (const p of buildProviderDrivers(ioProviders, this.boardCatalog.expansionCatalog())) {
        result.push({ id: p.id, label: `${p.id} (${p.type})`, driver: p.driver });
      }
    } catch (err) {
      // Unknown/invalid provider type — surface it. The old silent catch hid
      // exactly this, vanishing providers from the pin selector while codegen
      // still emitted them.
      console.error('Failed to build I/O provider drivers', err);
    }
    return result;
  }

  /**
   * Full pipeline: build drivers, compute reserved, enumerate channels
   * (filtering reserved + capability), and group by provider.
   */
  private _channelGroups(
    board: BoardDef,
    ioProviders: IoProviderDef[],
    usedPins: Map<string, string>,
    cap?: PinCap,
  ): Array<{ provider: string; label: string; channels: Array<{
    id: string; label: string; caps: PinCap[]; usedBy?: string;
  }> }> {
    const drivers = this._buildDrivers(board, ioProviders);

    const reserved = reservedPins(board);
    for (const { id, driver } of drivers) {
      if (id === 'board') continue;
      for (const pin of driver.consumedPins?.() ?? []) {
        reserved.set(pin, `${id} infrastructure`);
      }
    }

    const channels = this._enumerateChannels(drivers, usedPins, reserved, cap);
    return this._groupChannels(channels);
  }

  /** Enumerate channels from drivers, filtering reserved + capability + marking used. */
  private _enumerateChannels(
    drivers: Array<{ id: string; label: string; driver: IoProviderDriver }>,
    usedPins: Map<string, string>,
    reserved: Map<string, string>,
    cap?: PinCap,
  ): Array<{
    id: string; label: string; caps: PinCap[];
    provider: string; providerLabel: string; usedBy?: string;
  }> {
    const result: Array<{
      id: string; label: string; caps: PinCap[];
      provider: string; providerLabel: string; usedBy?: string;
    }> = [];

    for (const { id: providerId, label, driver } of drivers) {
      for (const ch of driver.enumerate()) {
        const channelId = providerId === 'board' ? ch.fqid
          : ch.fqid ? `${providerId}:${ch.fqid}`
          : providerId;
        if (reserved.has(channelId)) continue;
        if (cap && !ch.caps.includes(cap)) continue;
        result.push({
          id: channelId, label: ch.label || channelId, caps: ch.caps,
          provider: providerId, providerLabel: label,
          usedBy: usedPins.get(channelId),
        });
      }
    }
    return result;
  }

  /** Group enumerated channels by provider. */
  private _groupChannels(
    channels: Array<{
      id: string; label: string; caps: PinCap[];
      provider: string; providerLabel: string; usedBy?: string;
    }>,
  ): Array<{ provider: string; label: string; channels: typeof channels }> {
    const groups = new Map<string, { provider: string; label: string; channels: typeof channels }>();
    for (const ch of channels) {
      let group = groups.get(ch.provider);
      if (!group) {
        group = { provider: ch.provider, label: ch.providerLabel, channels: [] };
        groups.set(ch.provider, group);
      }
      group.channels.push(ch);
    }
    return [...groups.values()];
  }
}
