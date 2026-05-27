import { Injectable, inject, signal, computed } from '@angular/core';
import type { PinDef, PinCap, BoardDef } from '../models/board.model';
import { reservedPins, exposedPins } from '../models/board.model';
import type { ValidationResult, RuleDiagnostic, GenerateResult } from '../models/electron-api';
import type { SystemTopology } from '../models/topology.model';
import type { IoProviderDef } from '@far-mon/core';
import { collectPins, NODE_REGISTRY, createBoardDriver, createProviderDriver } from '@far-mon/core';
import type { IoProviderDriver } from '@far-mon/core';
import { WorkspaceService } from './workspace.service';

@Injectable({ providedIn: 'root' })
export class SystemEditorService {
  private workspace = inject(WorkspaceService);

  // --- Session-specific state (NOT in workspace) ---
  private _readonly = signal(false);
  private _validation = signal<ValidationResult | null>(null);
  private _generatedFiles = signal<GenerateResult | null>(null);
  private _canvasSvg = signal<string | null>(null);

  // --- Delegated reads from workspace ---
  readonly topology = this.workspace.activeTopology;
  readonly board = this.workspace.activeBoard;
  readonly controllerId = this.workspace.activeControllerId;

  readonly dirty = this.workspace.dirty;

  readonly readonly = this._readonly.asReadonly();

  // --- Transport-agnostic channel computeds ---

  /** All driver instances — board is just another driver. */
  private readonly drivers = computed(() => {
    const board = this.board();
    const topology = this.topology();
    if (!board) return [];
    return this._buildDrivers(board, topology?.device.io_providers ?? []);
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

  /** @deprecated Use availableChannels() — this wrapper exists for backward compat. */
  availablePins(cap?: PinCap): (PinDef & { usedBy?: string })[] {
    const pins = this.boardPins();
    const reserved = this.reservedPins();
    const used = this.usedPins();
    return pins
      .filter(p => !reserved.has(p.gpio))
      .filter(p => !cap || p.caps.includes(cap))
      .map(p => ({ ...p, usedBy: used.get(p.gpio) }));
  }

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
    const topology = this.topology();
    if (!board) return [];
    return this._channelGroups(
      board,
      topology?.device.io_providers ?? [],
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
  updateTopology(updater: (t: SystemTopology) => void): void {
    if (this._readonly()) return;
    this.workspace.updateActiveTopology(updater);
  }

  /** Atomically swap the board for the active system. */
  changeBoard(board: BoardDef): void {
    if (this._readonly()) return;
    this.workspace.changeActiveBoard(board);
  }

  setValidation(result: ValidationResult): void {
    this._validation.set(result);
  }

  /** Save entire site atomically. */
  async save(): Promise<void> {
    await this.workspace.save();
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
    for (const provDef of ioProviders) {
      try {
        result.push({
          id: provDef.id,
          label: `${provDef.id} (${provDef.type})`,
          driver: createProviderDriver(provDef),
        });
      } catch { /* skip unknown types */ }
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
