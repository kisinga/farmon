import { Injectable, signal, computed } from '@angular/core';
import type { BoardDef, PinDef, PinCap } from '../models/board.model';
import { reservedPins, exposedPins } from '../models/board.model';
import type { ValidationResult, RuleDiagnostic } from '../models/electron-api';
import type { SystemTopology } from '../models/topology.model';
import { collectPins } from '../../../../shared/pin-collect';

@Injectable({ providedIn: 'root' })
export class SystemEditorService {
  // --- Core state: topology is the source of truth ---
  private _topology = signal<SystemTopology | null>(null);
  private _board = signal<BoardDef | null>(null);
  private _configName = signal<string | null>(null);
  private _dirty = signal(false);

  readonly topology = this._topology.asReadonly();
  readonly board = this._board.asReadonly();
  readonly configName = this._configName.asReadonly();
  readonly dirty = this._dirty.asReadonly();

  // --- Derived: pin usage (computed from topology) ---
  readonly reservedPins = computed(() => {
    const b = this._board();
    return b ? reservedPins(b) : new Map<string, string>();
  });

  readonly exposedPins = computed(() => {
    const b = this._board();
    return b ? exposedPins(b) : new Set<string>();
  });


  readonly pinUsages = computed(() => {
    const t = this._topology();
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
    const b = this._board();
    return b ? b.pins : [];
  });

  /**
   * Returns non-reserved pins, optionally filtered by capability.
   * Each pin is annotated with its current usage status.
   */
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
  private _validation = signal<ValidationResult | null>(null);
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

  // --- Actions ---

  load(name: string, topology: SystemTopology, board: BoardDef): void {
    this._configName.set(name);
    this._topology.set(structuredClone(topology));
    this._board.set(board);
    this._dirty.set(false);
    this._validation.set(null);
  }

  /** Mutate topology via an updater function. Marks config as dirty. */
  updateTopology(updater: (t: SystemTopology) => void): void {
    const t = this._topology();
    if (!t) return;
    const clone = structuredClone(t);
    updater(clone);
    this._topology.set(clone);
    this._dirty.set(true);
  }

  setValidation(result: ValidationResult): void {
    this._validation.set(result);
  }

  markSaved(): void {
    this._dirty.set(false);
  }

  clear(): void {
    this._topology.set(null);
    this._board.set(null);
    this._configName.set(null);
    this._dirty.set(false);
    this._validation.set(null);
  }
}
