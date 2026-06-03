import { Component, input, signal, computed, inject, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService, DeviceControl, DeviceField, DeviceRuleRecord, ExtraCondition } from '../../../core/services/api.service';
import {
  MAX_RULES,
  nextRuleId,
  isValidExtraConditionThreshold,
  clampExtraConditionThreshold,
} from '../../../core/utils/firmware-constraints';
import { SyncStatusBadgeComponent } from '../sync-status-badge/sync-status-badge.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import type { SyncState } from '../sync-status-badge/sync-status-badge.component';

const OPS = ['<', '>', '<=', '>=', '==', '!='] as const;
type Op = typeof OPS[number];

interface ConditionForm {
  type: 'sensor' | 'control_state';
  field_idx: number;
  operator: Op;
  threshold: number;
  control_idx: number;
  control_state: number;
  logic: 'and' | 'or';
}

interface RuleForm {
  field_idx: number;
  operator: Op;
  threshold: number;
  control_idx: number;
  action_state: number;
  priority: number;
  cooldown_seconds: number;
  action_dur_x10s: number;
  enabled: boolean;
  extra_conditions: ConditionForm[];
  has_time: boolean;
  time_start: number;
  time_end: number;
}

function defaultCondition(): ConditionForm {
  return {
    type: 'sensor', field_idx: 0, operator: '<', threshold: 0,
    control_idx: 0, control_state: 0, logic: 'and',
  };
}

function defaultForm(): RuleForm {
  return {
    field_idx: 0, operator: '<', threshold: 0,
    control_idx: 0, action_state: 0,
    priority: 128, cooldown_seconds: 300, action_dur_x10s: 0, enabled: true,
    extra_conditions: [],
    has_time: false, time_start: 6, time_end: 18,
  };
}

/**
 * DeviceAutomationsSectionComponent — on-device edge rule builder.
 *
 * Used on both config page (readonly=false) and monitoring page (readonly=true).
 * Fixes from device-rules-section:
 *   - form is a signal<RuleForm> (not a plain mutable object)
 *   - rule_id uses nextRuleId() instead of rules().length (safe after deletions)
 *   - extra condition thresholds are validated/clamped to uint8 (0–255)
 *   - max 9 rules enforced — "Add rule" button disabled when at limit
 */
@Component({
  selector: 'app-device-automations-section',
  standalone: true,
  imports: [FormsModule, CommonModule, SyncStatusBadgeComponent, ConfirmDialogComponent],
  template: `
    <div class="space-y-4">

      <!-- Status message -->
      @if (message()) {
        <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
          <span>{{ message() }}</span>
        </div>
      }

      <!-- Rule counter -->
      @if (rules().length > 0 || !readonly()) {
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs text-base-content/50">
            {{ rules().length }} / {{ maxRules }} automation rules
            @if (atCapacity()) { <span class="text-warning ml-1">(at limit)</span> }
          </span>
        </div>
      }

      <!-- Empty state -->
      @if (rules().length === 0 && !loading()) {
        <p class="text-sm text-base-content/60">
          No automations. They run directly on the device for instant, offline-capable control.
        </p>
      }

      <!-- Rule cards -->
      @for (r of rules(); track r.id) {
        <div class="border border-base-300 rounded-xl bg-base-100 p-4 space-y-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-xs font-mono text-base-content/50">Rule #{{ r.rule_id }} · P{{ r.priority ?? 128 }}</span>
            <div class="flex items-center gap-2 flex-wrap">
              <app-sync-status-badge [state]="ruleSyncState(r)" />
              @if (!readonly()) {
                <input type="checkbox" class="toggle toggle-xs toggle-primary"
                  [checked]="r.enabled !== false"
                  (change)="toggleEnabled(r)" />
                <button class="btn btn-xs btn-ghost" (click)="startEdit(r)">Edit</button>
                <button class="btn btn-xs btn-ghost text-error" (click)="confirmDeleteRule.set(r)">Delete</button>
              }
            </div>
          </div>

          <!-- Natural language display -->
          <div class="text-sm space-y-0.5">
            <div>
              <span class="text-base-content/50 uppercase text-xs font-semibold mr-1">IF</span>
              <span class="font-medium">{{ fieldName(r.field_idx) }}</span>
              <span class="mx-1 font-mono text-primary">{{ r.operator }}</span>
              <span class="font-medium">{{ r.threshold }}</span>
              @for (ec of r.extra_conditions ?? []; track $index) {
                <span class="mx-1 text-base-content/50 uppercase text-xs font-semibold">{{ ec.logic }}</span>
                @if (ec.is_control) {
                  <span class="font-medium">{{ controlName(ec.field_idx) }}</span>
                  <span class="mx-1 font-mono text-primary">=</span>
                  <span class="font-medium">{{ stateName(ec.field_idx, ec.threshold) }}</span>
                } @else {
                  <span class="font-medium">{{ fieldName(ec.field_idx) }}</span>
                  <span class="mx-1 font-mono text-primary">{{ ec.operator }}</span>
                  <span class="font-medium">{{ ec.threshold }}</span>
                }
              }
            </div>
            <div>
              <span class="text-base-content/50 uppercase text-xs font-semibold mr-1">THEN</span>
              set <span class="font-medium">{{ controlName(r.control_idx) }}</span>
              → <span class="font-medium">{{ stateName(r.control_idx, r.action_state) }}</span>
            </div>
            @if ((r.time_start ?? -1) >= 0 && (r.time_end ?? -1) >= 0) {
              <div class="flex items-center gap-1.5 text-xs text-base-content/50">
                <span class="inline-block w-2 h-2 rounded-full"
                  [class]="r.window_active !== false ? 'bg-success' : 'bg-base-300'"></span>
                Schedule: {{ padHour(r.time_start!) }}:00–{{ padHour(r.time_end!) }}:00
                @if (r.window_active !== false) { <span class="text-success">(active now)</span> }
                @else { <span>(inactive)</span> }
              </div>
            }
            @if ((r.cooldown_seconds ?? 0) > 0 || (r.action_dur_x10s ?? 0) > 0) {
              <div class="text-xs text-base-content/50">
                @if ((r.cooldown_seconds ?? 0) > 0) { Cooldown {{ formatDuration(r.cooldown_seconds!) }} }
                @if ((r.cooldown_seconds ?? 0) > 0 && (r.action_dur_x10s ?? 0) > 0) { · }
                @if ((r.action_dur_x10s ?? 0) > 0) { Hold {{ formatDuration(r.action_dur_x10s! * 10) }} }
              </div>
            }
          </div>
        </div>
      }

      @if (!readonly()) {
        <!-- Push to device button -->
        @if (rules().length > 0) {
          <button class="btn btn-sm btn-outline btn-primary w-full" (click)="pushRules()" [disabled]="pushing()">
            @if (pushing()) { <span class="loading loading-spinner loading-xs"></span> Pushing… }
            @else { Push automations to device }
          </button>
        }

        <!-- Add / Edit form -->
        <details class="collapse collapse-arrow border border-base-300 rounded-xl bg-base-200/30"
          [attr.open]="editingId() ? '' : null">
          <summary class="collapse-title text-sm font-semibold py-2 min-h-0">
            {{ editingId() ? 'Edit automation' : 'Add automation' }}
            @if (atCapacity() && !editingId()) {
              <span class="badge badge-warning badge-xs ml-2">limit reached</span>
            }
          </summary>
          <div class="collapse-content px-0">
            <div class="p-4 space-y-5">

              <!-- 1. Primary condition -->
              <div class="space-y-2">
                <p class="text-xs font-semibold text-base-content/60 uppercase">Condition</p>
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Field</label>
                    <select class="select select-bordered select-sm"
                      [ngModel]="form().field_idx"
                      (ngModelChange)="patchForm('field_idx', $event)">
                      @for (f of fieldOptions(); track f.value) {
                        <option [value]="f.value">{{ f.label }}</option>
                      }
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Operator</label>
                    <select class="select select-bordered select-sm w-20"
                      [ngModel]="form().operator"
                      (ngModelChange)="patchForm('operator', $event)">
                      @for (op of ops; track op) { <option [value]="op">{{ op }}</option> }
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Threshold</label>
                    <input type="number" class="input input-bordered input-sm w-28"
                      [ngModel]="form().threshold"
                      (ngModelChange)="patchForm('threshold', $event)"
                      step="any" />
                  </div>
                </div>
              </div>

              <!-- 2. Extra conditions -->
              @for (ec of form().extra_conditions; track $index) {
                <div class="space-y-2 pl-4 border-l-2 border-base-300">
                  <div class="flex items-center justify-between">
                    <div class="flex gap-4 items-center">
                      <span class="text-xs text-base-content/50">Logic</span>
                      <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" class="radio radio-xs" [name]="'logic_' + $index"
                          value="and" [ngModel]="ec.logic" (ngModelChange)="patchCondition($index, 'logic', $event)" />
                        <span class="text-sm">AND</span>
                      </label>
                      <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" class="radio radio-xs" [name]="'logic_' + $index"
                          value="or" [ngModel]="ec.logic" (ngModelChange)="patchCondition($index, 'logic', $event)" />
                        <span class="text-sm">OR</span>
                      </label>
                    </div>
                    <button class="btn btn-xs btn-ghost text-error" (click)="removeCondition($index)">×</button>
                  </div>
                  <div class="flex gap-4 items-center">
                    <span class="text-xs text-base-content/50">Type</span>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" class="radio radio-xs" [name]="'ctype_' + $index"
                        value="sensor" [ngModel]="ec.type" (ngModelChange)="patchCondition($index, 'type', $event)" />
                      <span class="text-sm">Sensor field</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" class="radio radio-xs" [name]="'ctype_' + $index"
                        value="control_state" [ngModel]="ec.type" (ngModelChange)="patchCondition($index, 'type', $event)" />
                      <span class="text-sm">Control state</span>
                    </label>
                  </div>
                  @if (ec.type === 'sensor') {
                    <div class="flex flex-wrap gap-2 items-end">
                      <div class="form-control">
                        <label class="label text-xs py-0.5">Field</label>
                        <select class="select select-bordered select-sm"
                          [ngModel]="ec.field_idx" (ngModelChange)="patchCondition($index, 'field_idx', $event)">
                          @for (f of fieldOptions(); track f.value) {
                            <option [value]="f.value">{{ f.label }}</option>
                          }
                        </select>
                      </div>
                      <div class="form-control">
                        <label class="label text-xs py-0.5">Operator</label>
                        <select class="select select-bordered select-sm w-20"
                          [ngModel]="ec.operator" (ngModelChange)="patchCondition($index, 'operator', $event)">
                          @for (op of ops; track op) { <option [value]="op">{{ op }}</option> }
                        </select>
                      </div>
                      <div class="form-control">
                        <label class="label text-xs py-0.5">Threshold <span class="text-base-content/40">(0–255)</span></label>
                        <input type="number" class="input input-bordered input-sm w-24"
                          [ngModel]="ec.threshold"
                          (ngModelChange)="patchConditionThreshold($index, $event)"
                          min="0" max="255" step="1" />
                        @if (!isValidExtraConditionThreshold(ec.threshold)) {
                          <p class="text-xs text-error mt-0.5">Must be integer 0–255</p>
                        }
                      </div>
                    </div>
                  } @else {
                    <div class="flex flex-wrap gap-2 items-end">
                      <div class="form-control">
                        <label class="label text-xs py-0.5">Control</label>
                        <select class="select select-bordered select-sm"
                          [ngModel]="ec.control_idx"
                          (ngModelChange)="patchCondition($index, 'control_idx', $event); patchCondition($index, 'control_state', 0)">
                          @for (c of controlOptions(); track c.value) {
                            <option [value]="c.value">{{ c.label }}</option>
                          }
                        </select>
                      </div>
                      <span class="self-end mb-2 text-sm text-base-content/50">equals</span>
                      <div class="form-control">
                        <label class="label text-xs py-0.5">State</label>
                        <select class="select select-bordered select-sm"
                          [ngModel]="ec.control_state" (ngModelChange)="patchCondition($index, 'control_state', $event)">
                          @for (s of stateOptionsFor(ec.control_idx); track s.value) {
                            <option [value]="s.value">{{ s.label }}</option>
                          }
                        </select>
                      </div>
                    </div>
                  }
                </div>
              }
              @if (form().extra_conditions.length < 3) {
                <button class="btn btn-xs btn-ghost text-primary" (click)="addCondition()" [disabled]="atCapacity() && !editingId()">
                  + Add condition
                </button>
              }
              @if (form().extra_conditions.length > 0) {
                <p class="text-xs text-base-content/40">Extra condition thresholds are integer-only (0–255). For fractional values use a server workflow.</p>
              }

              <!-- 3. Action -->
              <div class="space-y-2">
                <p class="text-xs font-semibold text-base-content/60 uppercase">Action</p>
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Control</label>
                    <select class="select select-bordered select-sm"
                      [ngModel]="form().control_idx"
                      (ngModelChange)="patchForm('control_idx', $event); patchForm('action_state', 0)">
                      @for (c of controlOptions(); track c.value) {
                        <option [value]="c.value">{{ c.label }}</option>
                      }
                    </select>
                  </div>
                  <span class="self-end mb-2 text-sm text-base-content/50">→</span>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">State</label>
                    <select class="select select-bordered select-sm"
                      [ngModel]="form().action_state"
                      (ngModelChange)="patchForm('action_state', $event)">
                      @for (s of stateOptionsFor(form().control_idx); track s.value) {
                        <option [value]="s.value">{{ s.label }}</option>
                      }
                    </select>
                  </div>
                </div>
              </div>

              <!-- 4. Schedule -->
              <div class="space-y-2">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" class="checkbox checkbox-sm"
                    [ngModel]="form().has_time" (ngModelChange)="patchForm('has_time', $event)" />
                  <span class="text-xs font-semibold text-base-content/60 uppercase">Time window</span>
                  <span class="text-xs text-base-content/40">(server-managed)</span>
                </label>
                @if (form().has_time) {
                  <div class="pl-4 border-l-2 border-base-300 flex flex-wrap gap-2 items-end">
                    <div class="form-control">
                      <label class="label text-xs py-0.5">From (hour)</label>
                      <select class="select select-bordered select-sm w-24"
                        [ngModel]="form().time_start" (ngModelChange)="patchForm('time_start', $event)">
                        @for (h of hours; track h) { <option [value]="h">{{ padHour(h) }}:00</option> }
                      </select>
                    </div>
                    <div class="form-control">
                      <label class="label text-xs py-0.5">To (hour)</label>
                      <select class="select select-bordered select-sm w-24"
                        [ngModel]="form().time_end" (ngModelChange)="patchForm('time_end', $event)">
                        @for (h of hours; track h) { <option [value]="h">{{ padHour(h) }}:00</option> }
                      </select>
                    </div>
                  </div>
                }
              </div>

              <!-- 5. Tuning -->
              <div class="space-y-2">
                <p class="text-xs font-semibold text-base-content/60 uppercase">Tuning</p>
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Priority <span class="text-base-content/40">(0=highest)</span></label>
                    <input type="number" class="input input-bordered input-sm w-24"
                      [ngModel]="form().priority" (ngModelChange)="patchForm('priority', $event)" min="0" max="255" />
                  </div>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Cooldown (s)</label>
                    <input type="number" class="input input-bordered input-sm w-24"
                      [ngModel]="form().cooldown_seconds" (ngModelChange)="patchForm('cooldown_seconds', $event)" min="0" />
                  </div>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">Duration <span class="text-base-content/40">(×10s, 0=hold)</span></label>
                    <input type="number" class="input input-bordered input-sm w-24"
                      [ngModel]="form().action_dur_x10s" (ngModelChange)="patchForm('action_dur_x10s', $event)" min="0" max="255" />
                  </div>
                  <div class="form-control self-end">
                    <label class="label cursor-pointer gap-2 pb-2">
                      <span class="text-xs">Enabled</span>
                      <input type="checkbox" class="toggle toggle-xs toggle-primary"
                        [ngModel]="form().enabled" (ngModelChange)="patchForm('enabled', $event)" />
                    </label>
                  </div>
                </div>
              </div>

              <div class="flex gap-2 pt-1">
                <button class="btn btn-sm btn-primary"
                  (click)="saveRule()"
                  [disabled]="saving() || (atCapacity() && !editingId())">
                  {{ saving() ? 'Saving…' : (editingId() ? 'Update' : 'Add automation') }}
                </button>
                @if (editingId()) {
                  <button class="btn btn-sm btn-ghost" (click)="cancelEdit()">Cancel</button>
                }
              </div>

            </div>
          </div>
        </details>
      }

      <!-- Delete confirmation -->
      <app-confirm-dialog
        [open]="!!confirmDeleteRule()"
        title="Delete automation rule?"
        [message]="'Delete Rule #' + (confirmDeleteRule()?.rule_id ?? '') + '? This cannot be undone.'"
        confirmLabel="Delete"
        [dangerMode]="true"
        (confirmed)="executeDelete()"
        (cancelled)="confirmDeleteRule.set(null)"
      />

    </div>
  `,
})
export class DeviceAutomationsSectionComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  fields = input<DeviceField[]>([]);
  controls = input<DeviceControl[]>([]);
  /** When true, shows rules read-only (no add/edit/delete/push). Used on monitoring page. */
  readonly = input<boolean>(false);

  rules = signal<DeviceRuleRecord[]>([]);
  loading = signal(false);
  saving = signal(false);
  pushing = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);
  editingId = signal<string | null>(null);
  confirmDeleteRule = signal<DeviceRuleRecord | null>(null);
  private msgTimer: ReturnType<typeof setTimeout> | null = null;

  /** Signal-based form — replaces the plain mutable object anti-pattern. */
  form = signal<RuleForm>(defaultForm());

  readonly ops = OPS;
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly maxRules = MAX_RULES;

  /** Exposed to template for threshold validation display. */
  readonly isValidExtraConditionThreshold = isValidExtraConditionThreshold;

  atCapacity = computed(() => this.rules().length >= MAX_RULES);

  fieldOptions = computed(() =>
    this.fields().map((f, i) => ({
      value: f.field_idx ?? i,
      label: f.display_name ? `${f.display_name} (${f.field_key})` : f.field_key,
    }))
  );

  controlOptions = computed(() =>
    this.controls().map((c, i) => ({
      value: c.control_idx ?? i,
      label: c.display_name ? `${c.display_name} (${c.control_key})` : c.control_key,
    }))
  );

  constructor() {
    // Reload rules whenever eui changes
    effect(() => {
      const eui = this.eui();
      if (!eui) { this.rules.set([]); return; }
      this.loading.set(true);
      this.api.getDeviceRules(eui).subscribe({
        next: (list) => { this.rules.set(list); this.loading.set(false); },
        error: () => { this.rules.set([]); this.loading.set(false); },
      });
    });
  }

  // ── Form signal helpers ──────────────────────────────────────────────────

  patchForm<K extends keyof RuleForm>(key: K, value: RuleForm[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  patchCondition<K extends keyof ConditionForm>(index: number, key: K, value: ConditionForm[K]): void {
    this.form.update(f => {
      const conditions = f.extra_conditions.map((c, i) =>
        i === index ? { ...c, [key]: value } : c
      );
      return { ...f, extra_conditions: conditions };
    });
  }

  patchConditionThreshold(index: number, value: number): void {
    const clamped = clampExtraConditionThreshold(value);
    this.patchCondition(index, 'threshold', clamped);
  }

  // ── Name resolution ─────────────────────────────────────────────────────

  fieldName(idx: number): string {
    const f = this.fields().find((x, i) => (x.field_idx ?? i) === idx);
    return f ? (f.display_name || f.field_key) : `field #${idx}`;
  }

  controlName(idx: number): string {
    const c = this.controls().find((x, i) => (x.control_idx ?? i) === idx);
    return c ? (c.display_name || c.control_key) : `control #${idx}`;
  }

  stateName(controlIdx: number, stateIdx: number): string {
    const c = this.controls().find((x, i) => (x.control_idx ?? i) === controlIdx);
    if (c?.states_json && c.states_json[stateIdx] !== undefined) return c.states_json[stateIdx];
    return String(stateIdx);
  }

  stateOptionsFor(controlIdx: number): { value: number; label: string }[] {
    const c = this.controls().find((x, i) => (x.control_idx ?? i) === controlIdx);
    if (c?.states_json?.length) return c.states_json.map((s, i) => ({ value: i, label: s }));
    return [{ value: 0, label: 'off' }, { value: 1, label: 'on' }];
  }

  ruleSyncState(r: DeviceRuleRecord): SyncState {
    return r.synced_at ? 'synced' : 'saved';
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  padHour(h: number): string { return String(h).padStart(2, '0'); }

  formatDuration(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    return `${(sec / 3600).toFixed(1)}h`;
  }

  // ── Condition management ─────────────────────────────────────────────────

  addCondition(): void {
    this.form.update(f => ({
      ...f,
      extra_conditions: [...f.extra_conditions, defaultCondition()],
    }));
  }

  removeCondition(index: number): void {
    this.form.update(f => ({
      ...f,
      extra_conditions: f.extra_conditions.filter((_, i) => i !== index),
    }));
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  startEdit(r: DeviceRuleRecord): void {
    this.editingId.set(r.id);
    this.form.set({
      field_idx: r.field_idx,
      operator: r.operator as Op,
      threshold: r.threshold,
      control_idx: r.control_idx,
      action_state: r.action_state,
      priority: r.priority ?? 128,
      cooldown_seconds: r.cooldown_seconds ?? 300,
      action_dur_x10s: r.action_dur_x10s ?? 0,
      enabled: r.enabled !== false,
      extra_conditions: (r.extra_conditions ?? []).map(ec => ({
        type: ec.is_control ? 'control_state' as const : 'sensor' as const,
        field_idx: ec.field_idx,
        operator: (ec.operator as Op) ?? '<',
        threshold: ec.threshold,
        control_idx: ec.is_control ? ec.field_idx : 0,
        control_state: ec.is_control ? ec.threshold : 0,
        logic: ec.logic ?? 'and',
      })),
      has_time: (r.time_start ?? -1) >= 0 && (r.time_end ?? -1) >= 0,
      time_start: r.time_start ?? 6,
      time_end: r.time_end ?? 18,
    });
    this.message.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.set(defaultForm());
    this.message.set(null);
  }

  saveRule(): void {
    const eui = this.eui();
    if (!eui) return;
    const f = this.form();

    // Validate extra condition thresholds
    const badThreshold = f.extra_conditions.find(ec => ec.type === 'sensor' && !isValidExtraConditionThreshold(ec.threshold));
    if (badThreshold) {
      this.showMsg('Extra condition thresholds must be integers between 0 and 255.', true);
      return;
    }

    this.saving.set(true);
    this.message.set(null);

    const extra_conditions: ExtraCondition[] = f.extra_conditions.map(ec => {
      const isControl = ec.type === 'control_state';
      return {
        field_idx: isControl ? ec.control_idx : ec.field_idx,
        operator: isControl ? '==' : ec.operator,
        threshold: isControl ? ec.control_state : clampExtraConditionThreshold(ec.threshold),
        is_control: isControl,
        logic: ec.logic,
      };
    });

    const record: Partial<DeviceRuleRecord> = {
      device_eui: eui,
      // Use nextRuleId() for new rules — NOT rules().length (breaks after deletions)
      rule_id: this.editingId() ? undefined : nextRuleId(this.rules()),
      field_idx: f.field_idx,
      operator: f.operator,
      threshold: f.threshold,
      control_idx: f.control_idx,
      action_state: f.action_state,
      priority: f.priority,
      cooldown_seconds: f.cooldown_seconds,
      action_dur_x10s: f.action_dur_x10s,
      enabled: f.enabled,
      extra_conditions,
      time_start: f.has_time ? f.time_start : -1,
      time_end: f.has_time ? f.time_end : -1,
      synced_at: '',
    };

    const id = this.editingId();
    const op$ = id
      ? this.api.updateDeviceRule(id, record)
      : this.api.createDeviceRule(record);

    op$.subscribe({
      next: () => {
        this.showMsg(id ? 'Automation updated.' : 'Automation added.');
        this.saving.set(false);
        this.editingId.set(null);
        this.form.set(defaultForm());
        this.api.getDeviceRules(eui).subscribe((list) => this.rules.set(list));
      },
      error: (err) => {
        this.showMsg(err?.error?.message ?? err?.message ?? 'Failed to save automation', true);
        this.saving.set(false);
      },
    });
  }

  toggleEnabled(r: DeviceRuleRecord): void {
    this.api.updateDeviceRule(r.id, { enabled: r.enabled === false, synced_at: '' }).subscribe({
      next: () => this.api.getDeviceRules(this.eui()).subscribe((list) => this.rules.set(list)),
    });
  }

  executeDelete(): void {
    const r = this.confirmDeleteRule();
    if (!r) return;
    this.confirmDeleteRule.set(null);
    this.api.deleteDeviceRule(r.id).subscribe({
      next: () => this.rules.update((list) => list.filter((x) => x.id !== r.id)),
    });
  }

  pushRules(): void {
    const eui = this.eui();
    if (!eui) return;
    this.pushing.set(true);
    this.message.set(null);
    this.api.pushDeviceRules(eui).subscribe({
      next: (res) => {
        this.showMsg(`Pushed ${res.rules_pushed} rule${res.rules_pushed !== 1 ? 's' : ''} to device.`);
        this.pushing.set(false);
        this.api.getDeviceRules(eui).subscribe((list) => this.rules.set(list));
      },
      error: (err) => {
        this.showMsg(err?.error?.error ?? 'Push failed', true);
        this.pushing.set(false);
      },
    });
  }

  private showMsg(msg: string, error = false): void {
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.isError.set(error);
    this.message.set(msg);
    if (!error) this.msgTimer = setTimeout(() => this.message.set(null), 4000);
  }
}
