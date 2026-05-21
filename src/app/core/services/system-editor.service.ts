import { Injectable, inject, signal, computed } from '@angular/core';
import type { PinDef, PinCap, BoardDef } from '../models/board.model';
import { reservedPins, exposedPins } from '../models/board.model';
import type { ValidationResult, RuleDiagnostic, GenerateResult } from '../models/electron-api';
import type { SystemTopology } from '../models/topology.model';
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
  readonly systemId = this.workspace.activeSystemId;

  readonly dirty = this.workspace.dirty;

  readonly readonly = this._readonly.asReadonly();

  // --- Transport-agnostic channel computeds ---

  /** All driver instances — board is just another driver. */
  private readonly drivers = computed(() => {
    const board = this.board();
    const topology = this.topology();
    if (!board) return [];

    const result: Array<{ id: string; label: string; driver: IoProviderDriver }> = [
      { id: 'board', label: 'Board', driver: createBoardDriver(board) },
    ];

    for (const provDef of topology?.device.io_providers ?? []) {
      try {
        result.push({
          id: provDef.id,
          label: `${provDef.id} (${provDef.type})`,
          driver: createProviderDriver(provDef),
        });
      } catch { /* skip unknown types */ }
    }
    return result;
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
    const reserved = this.reservedPins();
    const used = this.usedPins();
    const result: Array<{
      id: string; label: string; caps: PinCap[];
      provider: string; providerLabel: string; usedBy?: string;
    }> = [];

    for (const { id: providerId, label, driver } of this.drivers()) {
      for (const ch of driver.enumerate()) {
        // Channel ID: board uses fqid directly, providers prefix with "providerId:",
        // transport endpoints (fqid empty) use providerId as the channel ID.
        const channelId = providerId === 'board' ? ch.fqid
          : ch.fqid ? `${providerId}:${ch.fqid}`
          : providerId;
        if (reserved.has(channelId)) continue;
        if (cap && !ch.caps.includes(cap)) continue;
        result.push({
          id: channelId, label: ch.label || channelId, caps: ch.caps,
          provider: providerId, providerLabel: label,
          usedBy: used.get(channelId),
        });
      }
    }
    return result;
  }

  /** Group channels by provider for two-step selector. */
  channelGroups(cap?: PinCap): Array<{ provider: string; label: string; channels: Array<{
    id: string; label: string; caps: PinCap[]; usedBy?: string;
  }> }> {
    const channels = this.availableChannels(cap);
    const groups = new Map<string, { provider: string; label: string; channels: typeof channels }>();
    for (const ch of channels) {
      let group = groups.get(ch.provider);
      if (!group) { group = { provider: ch.provider, label: ch.providerLabel, channels: [] }; groups.set(ch.provider, group); }
      group.channels.push(ch);
    }
    return [...groups.values()];
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

  /** Focus on a system for editing. Workspace must already have it loaded. */
  focus(systemId: string, opts?: { readonly?: boolean }): void {
    this.workspace.focusSystem(systemId);
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

  /**
   * Add a remote node bound to a provider entity on another controller.
   * The node is created with `remote` set and positioned at the canvas center.
   */
  addRemoteNode(
    kind: string,
    providerSystemId: string,
    providerNodeId: string,
    providerEntityKey: string,
    position?: { x: number; y: number },
  ): string {
    const id = this.workspace.nextNodeId(kind);
    const desc = NODE_REGISTRY.get(kind);
    if (!desc) throw new Error(`Unknown node kind: ${kind}`);

    this.updateTopology((t) => {
      t.nodes.push({
        kind,
        id,
        ...desc.defaultData(0),
        ports: desc.defaultPorts.map(p => ({ ...p })),
        position: position ?? { x: 100, y: 100 },
        remote: { providerSystemId, providerNodeId, providerEntityKey },
      } as any);
    });

    return id;
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
          (node as unknown as Record<string, unknown>)[field.key] = '';
        }
      }
    });
  }

  clear(): void {
    this.workspace.unfocusSystem();
    this._readonly.set(false);
    this._validation.set(null);
    this._generatedFiles.set(null);
    this._canvasSvg.set(null);
  }
}
