import { Injectable, inject, signal, computed } from '@angular/core';
import type { PinDef, PinCap } from '../models/board.model';
import { reservedPins, exposedPins } from '../models/board.model';
import type { ValidationResult, RuleDiagnostic, GenerateResult } from '../models/electron-api';
import type { SystemTopology } from '../models/topology.model';
import { collectPins, NODE_REGISTRY } from '@far-mon/core';
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

  // --- Pin computeds (derived from delegated topology/board) ---

  readonly reservedPins = computed(() => {
    const b = this.board();
    return b ? reservedPins(b) : new Map<string, string>();
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

  availablePins(cap?: PinCap): (PinDef & { usedBy?: string })[] {
    const pins = this.boardPins();
    const reserved = this.reservedPins();
    const used = this.usedPins();
    return pins
      .filter(p => !reserved.has(p.gpio))
      .filter(p => !cap || p.caps.includes(cap))
      .map(p => ({ ...p, usedBy: used.get(p.gpio) }));
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
