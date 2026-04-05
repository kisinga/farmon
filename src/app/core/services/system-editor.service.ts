import { Injectable, signal, computed } from '@angular/core';
import type { BoardDef } from '../models/board.model';
import { reservedPins, exposedPins, pinsWithCap } from '../models/board.model';
import type { ValidationResult } from '../models/electron-api';
import type { SystemTopology } from '../models/topology.model';
import { getNodesByKind, getNodeByKind } from '../models/topology.model';

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

  readonly adcPins = computed(() => {
    const b = this._board();
    return b ? pinsWithCap(b, 'adc') : new Set<string>();
  });

  readonly pcntPins = computed(() => {
    const b = this._board();
    return b ? pinsWithCap(b, 'pulse_counter') : new Set<string>();
  });

  readonly usedPins = computed(() => {
    const t = this._topology();
    if (!t) return new Map<string, string>();
    const pins = new Map<string, string>();
    const pump = getNodeByKind(t, 'pump');
    if (pump?.pin) pins.set(pump.pin, 'pump');
    for (const tank of getNodesByKind(t, 'tank')) {
      if (tank.level_pin) pins.set(tank.level_pin, `tank:${tank.id}`);
    }
    for (const v of getNodesByKind(t, 'valve')) {
      if (v.open_pin) pins.set(v.open_pin, `valve:${v.id}:open`);
      if (v.close_pin) pins.set(v.close_pin, `valve:${v.id}:close`);
    }
    for (const f of getNodesByKind(t, 'flow_sensor')) {
      if (f.pin) pins.set(f.pin, `flow:${f.id}`);
    }
    return pins;
  });

  readonly gpioUsage = computed(() => {
    const used = this.usedPins().size;
    const total = this.exposedPins().size;
    return { used, total, percent: total > 0 ? Math.round((used / total) * 100) : 0 };
  });

  // --- Validation ---
  private _validation = signal<ValidationResult | null>(null);
  readonly validation = this._validation.asReadonly();

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
