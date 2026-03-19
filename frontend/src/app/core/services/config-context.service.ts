import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ApiService } from './api.service';
import {
  Device,
  DeviceControl,
  DeviceDecodeRule,
  DeviceField,
  DeviceRuleRecord,
  DeviceSpec,
  DeviceVariable,
  PinCapabilitiesResponse,
  ValidationError,
} from './api.types';
import { PinFunctionName, rulesReferencingFieldIndex, validateRuleSet } from '../utils/firmware-constraints';

/** Describes which pin the user is currently picking and what constraints apply. */
export interface PinPickerMode {
  capability: PinFunctionName;
  /** 'primary' = main pin, 'secondary' = second pin (motorized valve). */
  target: 'primary' | 'secondary';
  /** Pins to treat as unavailable: already used by others + the sibling pin of a dual assignment. */
  excludedPins: Set<number>;
}

/**
 * ConfigContextService — single source of truth for the device configuration page.
 *
 * Replaces the ~250 lines of direct PocketBase calls scattered across DeviceConfigComponent.
 * All mutations route through this service; components only call the methods here.
 *
 * Usage: inject in DeviceConfigComponent and pass down to tab components.
 */
@Injectable({ providedIn: 'root' })
export class ConfigContextService {
  private api = inject(ApiService);

  // ─── Private writable signals ───────────────────────────────────────────────

  private _eui = signal<string>('');
  private _device = signal<Device | null>(null);
  private _fields = signal<DeviceField[]>([]);
  private _controls = signal<DeviceControl[]>([]);
  private _decodeRules = signal<DeviceDecodeRule[]>([]);
  private _rules = signal<DeviceRuleRecord[]>([]);   // for pre-delete reference checks
  private _pinCaps = signal<PinCapabilitiesResponse | null>(null);
  private _deviceSpec = signal<DeviceSpec | null>(null);
  private _loading = signal(false);
  private _saving = signal(false);
  private _error = signal<string | null>(null);
  private _flashMessage = signal<{ text: string; isError: boolean } | null>(null);

  // ─── Pin picker state (shared between board SVG and forms) ───────────────────
  private _pinPickerMode = signal<PinPickerMode | null>(null);
  /**
   * When non-null, the board SVG is in interactive mode.
   * The form that opened the picker watches lastPinPick() to receive the result.
   */
  private _lastPinPick = signal<{ pin: number; target: 'primary' | 'secondary' } | null>(null);

  // ─── Public readonly signals ────────────────────────────────────────────────

  eui = this._eui.asReadonly();
  device = this._device.asReadonly();
  fields = this._fields.asReadonly();
  controls = this._controls.asReadonly();
  decodeRules = this._decodeRules.asReadonly();
  rules = this._rules.asReadonly();
  pinCaps = this._pinCaps.asReadonly();
  deviceSpec = this._deviceSpec.asReadonly();
  loading = this._loading.asReadonly();
  saving = this._saving.asReadonly();
  error = this._error.asReadonly();
  flashMessage = this._flashMessage.asReadonly();

  /** Current pin picker state. Non-null when a form has opened a pin selection. */
  pinPickerMode = this._pinPickerMode.asReadonly();
  /** True when a form is waiting for a pin to be clicked on the board. */
  isPinPickerActive = computed(() => this._pinPickerMode() !== null);
  /** Emits the last pin picked from the board. Forms watch this with effect(). */
  lastPinPick = this._lastPinPick.asReadonly();

  // ─── Computed slices ────────────────────────────────────────────────────────

  /** Variables linked to a sensor/hardware input. Read-only in the Variables tab. */
  inputVariables = computed<DeviceVariable[]>(() =>
    this._fields().filter(f => f.linked_type === 'input')
  );

  /** Variables linked to an actuator output state. Auto-created, read-only in Variables tab. */
  outputVariables = computed<DeviceVariable[]>(() =>
    this._fields().filter(f => f.linked_type === 'output')
  );

  /** User-created intermediary/compute variables with expression. Editable in Variables tab. */
  computeVariables = computed<DeviceVariable[]>(() =>
    this._fields().filter(f => f.linked_type === 'compute')
  );

  /** True when the device uses AirConfig (embedded firmware config). */
  isAirConfig = computed(() => this._device()?.device_type === 'airconfig');

  /** True when device transport is LoRaWAN (default if unspecified). */
  isLoRaWAN = computed(() => (this._device()?.transport ?? 'lorawan') === 'lorawan');

  /** Set of pin indices currently occupied by controls (pin_index and pin2_index). */
  usedControlPins = computed<Set<number>>(() => {
    const pins = new Set<number>();
    for (const ctrl of this._controls()) {
      if (ctrl.pin_index != null) pins.add(ctrl.pin_index);
      if (ctrl.pin2_index != null && ctrl.pin2_index !== 255) pins.add(ctrl.pin2_index);
    }
    return pins;
  });

  /** pin_map array from the device spec (index = pin, value = function code). */
  pinMapArray = computed<number[]>(() =>
    this._deviceSpec()?.airconfig?.pin_map ?? []
  );

  /** Set of pin indices currently occupied by sensor inputs (pin_index !== 255). */
  usedSensorPins = computed<Set<number>>(() => {
    const pins = new Set<number>();
    for (const s of this._deviceSpec()?.airconfig?.sensors ?? []) {
      if (s.pin_index !== 255) pins.add(s.pin_index);
    }
    return pins;
  });

  /** Union of sensor pins and control pins — full used-pin set for both inputs and outputs. */
  allUsedPins = computed<Set<number>>(() => {
    const pins = new Set<number>();
    for (const p of this.usedSensorPins()) pins.add(p);
    for (const p of this.usedControlPins()) pins.add(p);
    return pins;
  });

  /** Count of variables with report_mode='reported' (counts toward LoRaWAN field budget). */
  reportedVariableCount = computed(() =>
    this._fields().filter(f => (f.report_mode ?? 'reported') === 'reported').length
  );

  /**
   * AirConfig sync state derived from device.config_status.
   * 'synced' = device has received and applied current config.
   * 'saved'  = saved to backend but not yet pushed to device.
   * 'unsaved' = no config record yet.
   */
  airConfigSyncState = computed<'synced' | 'saved' | 'unsaved'>(() => {
    const status = this._device()?.config_status;
    if (status === 'synced') return 'synced';
    if (status === 'pending') return 'saved';
    return 'unsaved';
  });

  // ─── Load / Reload ──────────────────────────────────────────────────────────

  /**
   * Load all config data for a device. Uses forkJoin for parallel fetching.
   * Safe to call on every route activation.
   */
  load(eui: string): void {
    if (!eui) {
      this.clear();
      return;
    }

    this._eui.set(eui);
    this._loading.set(true);
    this._error.set(null);

    forkJoin({
      device:      this.api.getDeviceConfig(eui),
      fields:      this.api.getDeviceFields(eui),
      controls:    this.api.getDeviceControls(eui),
      decodeRules: this.api.getDeviceDecodeRules(eui).pipe(catchError(() => of<DeviceDecodeRule[]>([]))),
      rules:       this.api.getDeviceRules(eui).pipe(catchError(() => of<DeviceRuleRecord[]>([]))),
      pinCaps:     this.api.getPinCapabilities(eui).pipe(catchError(() => of(null))),
      deviceSpec:  this.api.getDeviceSpec(eui).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ device, fields, controls, decodeRules, rules, pinCaps, deviceSpec }) => {
        this._device.set(device);
        this._fields.set(fields);
        this._controls.set(controls);
        this._decodeRules.set(decodeRules);
        this._rules.set(rules);
        this._pinCaps.set(pinCaps);
        this._deviceSpec.set(deviceSpec);
        this._loading.set(false);
      },
      error: (err) => {
        this._error.set(err?.message ?? 'Failed to load device configuration');
        this._loading.set(false);
      },
    });
  }

  reloadFields(): void {
    const eui = this._eui();
    if (!eui) return;
    this.api.getDeviceFields(eui).subscribe({
      next: fields => this._fields.set(fields),
      error: err => this.flash(err?.message ?? 'Failed to reload variables', true),
    });
  }

  reloadControls(): void {
    const eui = this._eui();
    if (!eui) return;
    this.api.getDeviceControls(eui).subscribe({
      next: controls => this._controls.set(controls),
      error: err => this.flash(err?.message ?? 'Failed to reload outputs', true),
    });
  }

  reloadDecodeRules(): void {
    const eui = this._eui();
    if (!eui) return;
    this.api.getDeviceDecodeRules(eui).subscribe({
      next: rules => this._decodeRules.set(rules),
      error: err => this.flash(err?.message ?? 'Failed to reload decode rules', true),
    });
  }

  reloadDeviceSpec(): void {
    const eui = this._eui();
    if (!eui) return;
    this.api.getDeviceSpec(eui).subscribe({
      next: spec => this._deviceSpec.set(spec),
      error: () => { /* non-fatal */ },
    });
  }

  reloadRules(): void {
    const eui = this._eui();
    if (!eui) return;
    this.api.getDeviceRules(eui).subscribe({
      next: rules => this._rules.set(rules),
      error: () => { /* non-fatal */ },
    });
  }

  reloadAll(): void {
    this.load(this._eui());
  }

  // ─── Field deletion safety ───────────────────────────────────────────────────

  /**
   * Returns all rules that reference the given field index (primary condition or extra conditions).
   * Call before deleting a variable to check for dependencies.
   */
  getRulesReferencingField(fieldIdx: number): DeviceRuleRecord[] {
    return rulesReferencingFieldIndex(this._rules(), fieldIdx);
  }

  /**
   * Returns whether a variable can be safely deleted.
   * Blocks deletion if any rule references the variable's field_idx.
   */
  canDeleteVariable(variable: DeviceVariable): { allowed: boolean; reason?: string; blockingRules: DeviceRuleRecord[] } {
    const fieldIdx = variable.field_idx;
    if (fieldIdx == null) {
      return { allowed: true, blockingRules: [] };
    }

    const blockingRules = this.getRulesReferencingField(fieldIdx);
    if (blockingRules.length > 0) {
      return {
        allowed: false,
        reason: `This variable is referenced by ${blockingRules.length} automation rule(s). Remove those rules before deleting.`,
        blockingRules,
      };
    }

    return { allowed: true, blockingRules: [] };
  }

  // ─── Validation ──────────────────────────────────────────────────────────────

  /** Validate the full rule set against firmware constraints. Returned errors are display-ready. */
  validateRules(): ValidationError[] {
    return validateRuleSet(this._rules(), this._fields());
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────────

  /** Show a toast/flash message. Auto-clears after 4 seconds. */
  flash(text: string, isError = false): void {
    this._flashMessage.set({ text, isError });
    setTimeout(() => this._flashMessage.set(null), 4000);
  }

  setSaving(saving: boolean): void {
    this._saving.set(saving);
  }

  // ─── Pin picker ──────────────────────────────────────────────────────────────

  /** Open the board in interactive mode. Call from OutputFormComponent or DeviceSensorConfigComponent. */
  openPinPicker(capability: PinFunctionName, target: 'primary' | 'secondary', excludedPins: Set<number>): void {
    this._lastPinPick.set(null);
    this._pinPickerMode.set({ capability, target, excludedPins });
  }

  /** Close the picker without a selection (cancel / cleanup on form destroy). */
  closePinPicker(): void {
    this._pinPickerMode.set(null);
  }

  /**
   * Called by DeviceBoardSvgComponent when the user clicks a valid pin.
   * Stores the result in lastPinPick (forms react via effect()), then closes.
   */
  onBoardPinClicked(pin: number): void {
    const mode = this._pinPickerMode();
    if (!mode) return;
    this._lastPinPick.set({ pin, target: mode.target });
    this._pinPickerMode.set(null);
  }

  // ─── Clear ───────────────────────────────────────────────────────────────────

  clear(): void {
    this._eui.set('');
    this._device.set(null);
    this._fields.set([]);
    this._controls.set([]);
    this._decodeRules.set([]);
    this._rules.set([]);
    this._pinCaps.set(null);
    this._deviceSpec.set(null);
    this._loading.set(false);
    this._saving.set(false);
    this._error.set(null);
    this._flashMessage.set(null);
    this._pinPickerMode.set(null);
    this._lastPinPick.set(null);
  }
}
