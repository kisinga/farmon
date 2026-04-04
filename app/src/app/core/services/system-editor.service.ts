import { Injectable, signal, computed } from '@angular/core';
import type { BoardDef } from '../models/board.model';
import { reservedPins, exposedPins, pinsWithCap } from '../models/board.model';
import type { ValidationResult } from '../models/electron-api';

/** Minimal manifest shape for the editor. */
export interface SystemManifest {
  device: {
    name: string;
    friendly_name: string;
    board: string;
    directory?: string;
  };
  pump: { pin: string };
  tanks: Array<{ name: string; id: string; level_pin: string }>;
  valves: Array<{ name: string; id: string; open_pin: string; close_pin: string }>;
  flow_sensors: Array<{ name: string; id: string; pin: string }>;
  routes: Array<{
    name: string;
    source: string;
    destination?: string;
    valves: string[];
    flow_sensor?: string;
    watchdog: 'flow' | 'level_rise' | 'runtime_only';
  }>;
  timing: Record<string, string | number>;
}

@Injectable({ providedIn: 'root' })
export class SystemEditorService {
  // --- Core state ---
  private _manifest = signal<SystemManifest | null>(null);
  private _board = signal<BoardDef | null>(null);
  private _configName = signal<string | null>(null);
  private _dirty = signal(false);

  readonly manifest = this._manifest.asReadonly();
  readonly board = this._board.asReadonly();
  readonly configName = this._configName.asReadonly();
  readonly dirty = this._dirty.asReadonly();

  // --- Derived: pin usage ---
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
    const m = this._manifest();
    if (!m) return new Map<string, string>();
    const pins = new Map<string, string>();
    pins.set(m.pump.pin, 'pump');
    for (const t of m.tanks) pins.set(t.level_pin, `tank:${t.id}`);
    for (const v of m.valves) {
      pins.set(v.open_pin, `valve:${v.id}:open`);
      pins.set(v.close_pin, `valve:${v.id}:close`);
    }
    for (const f of m.flow_sensors) pins.set(f.pin, `flow:${f.id}`);
    return pins;
  });

  readonly gpioUsage = computed(() => {
    const used = this.usedPins().size;
    const total = this.exposedPins().size;
    return { used, total, percent: total > 0 ? Math.round((used / total) * 100) : 0 };
  });

  // --- Validation (runs in-process, no IPC) ---
  // For real-time feedback we call the IPC validate endpoint
  // since lib/ validate is Node-only. In Electron this is fast.
  private _validation = signal<ValidationResult | null>(null);
  readonly validation = this._validation.asReadonly();

  // --- Actions ---

  load(name: string, manifest: SystemManifest, board: BoardDef): void {
    this._configName.set(name);
    this._manifest.set(structuredClone(manifest));
    this._board.set(board);
    this._dirty.set(false);
    this._validation.set(null);
  }

  updateManifest(updater: (m: SystemManifest) => void): void {
    const m = this._manifest();
    if (!m) return;
    const clone = structuredClone(m);
    updater(clone);
    this._manifest.set(clone);
    this._dirty.set(true);
  }

  setValidation(result: ValidationResult): void {
    this._validation.set(result);
  }

  markSaved(): void {
    this._dirty.set(false);
  }

  clear(): void {
    this._manifest.set(null);
    this._board.set(null);
    this._configName.set(null);
    this._dirty.set(false);
    this._validation.set(null);
  }
}
