import { Component, input, signal, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceControl, DeviceField, DeviceRuleRecord, ExtraCondition } from '../../../core/services/api.service';

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
    priority: 128, cooldown_seconds: 300, enabled: true,
    extra_conditions: [],
    has_time: false, time_start: 6, time_end: 18,
  };
}

@Component({
  selector: 'app-device-rules-section',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="space-y-4">

      <!-- Status message -->
      @if (message()) {
        <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
          <span>{{ message() }}</span>
        </div>
      }

      <!-- Empty state -->
      @if (rules().length === 0 && !loading()) {
        <p class="text-sm text-base-content/60">No device rules. Add one below — they run directly on the device for instant, offline-capable control.</p>
      }

      <!-- Rule cards -->
      @for (r of rules(); track r.id) {
        <div class="border border-base-300 rounded-xl bg-base-100 p-4 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-base-content/50">Rule #{{ r.rule_id }} · P{{ r.priority ?? 128 }}</span>
            <div class="flex items-center gap-2">
              @if (r.synced_at) {
                <span class="badge badge-xs badge-ghost">synced</span>
              } @else {
                <span class="badge badge-xs badge-warning">unsynced</span>
              }
              <input type="checkbox" class="toggle toggle-xs toggle-primary"
                [checked]="r.enabled !== false"
                (change)="toggleEnabled(r)" />
              <button class="btn btn-xs btn-ghost" (click)="startEdit(r)">Edit</button>
              <button class="btn btn-xs btn-ghost text-error" (click)="deleteRule(r.id)">Delete</button>
            </div>
          </div>

          <!-- Natural language rule display -->
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
                  [class]="'inline-block w-2 h-2 rounded-full ' + (r.window_active !== false ? 'bg-success' : 'bg-base-300')"></span>
                Schedule: {{ padHour(r.time_start!) }}:00–{{ padHour(r.time_end!) }}:00
                @if (r.window_active !== false) {
                  <span class="text-success">(active now)</span>
                } @else {
                  <span>(inactive)</span>
                }
              </div>
            }
            @if ((r.cooldown_seconds ?? 0) > 0) {
              <div class="text-xs text-base-content/50">Cooldown {{ formatDuration(r.cooldown_seconds!) }}</div>
            }
          </div>
        </div>
      }

      <!-- Push to device button -->
      @if (rules().length > 0) {
        <button class="btn btn-sm btn-outline btn-primary w-full" (click)="pushRules()" [disabled]="pushing()">
          @if (pushing()) { Pushing… } @else { Push rules to device }
        </button>
      }

      <!-- Add / Edit form -->
      <details class="collapse collapse-arrow border border-base-300 rounded-xl bg-base-200/30"
        [attr.open]="editingId() ? '' : null" #detailsEl>
        <summary class="collapse-title text-sm font-semibold py-2 min-h-0">
          {{ editingId() ? 'Edit rule' : 'Add device rule' }}
        </summary>
        <div class="collapse-content px-0">
          <div class="p-4 space-y-5">

            <!-- 1. Primary condition -->
            <div class="space-y-2">
              <p class="text-xs font-semibold text-base-content/60 uppercase">Condition</p>
              <div class="flex flex-wrap gap-2 items-end">
                <div class="form-control">
                  <label class="label text-xs py-0.5">Field</label>
                  <select class="select select-bordered select-sm" [(ngModel)]="form.field_idx">
                    @for (f of fieldOptions(); track f.value) {
                      <option [value]="f.value">{{ f.label }}</option>
                    }
                    @if (fieldOptions().length === 0) {
                      <option [value]="form.field_idx">field #{{ form.field_idx }}</option>
                    }
                  </select>
                </div>
                <div class="form-control">
                  <label class="label text-xs py-0.5">Operator</label>
                  <select class="select select-bordered select-sm w-20" [(ngModel)]="form.operator">
                    @for (op of ops; track op) { <option [value]="op">{{ op }}</option> }
                  </select>
                </div>
                <div class="form-control">
                  <label class="label text-xs py-0.5">Threshold</label>
                  <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.threshold" step="any" />
                </div>
              </div>
            </div>

            <!-- 2. Extra conditions (C2, C3, C4) -->
            @for (ec of form.extra_conditions; track $index) {
              <div class="space-y-2 pl-4 border-l-2 border-base-300">
                <div class="flex items-center justify-between">
                  <div class="flex gap-4 items-center">
                    <span class="text-xs text-base-content/50">Logic</span>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" class="radio radio-xs" [name]="'logic_' + $index" value="and" [(ngModel)]="ec.logic" />
                      <span class="text-sm">AND</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" class="radio radio-xs" [name]="'logic_' + $index" value="or" [(ngModel)]="ec.logic" />
                      <span class="text-sm">OR</span>
                    </label>
                  </div>
                  <button class="btn btn-xs btn-ghost text-error" (click)="removeCondition($index)">×</button>
                </div>
                <div class="flex gap-4 items-center">
                  <span class="text-xs text-base-content/50">Type</span>
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input type="radio" class="radio radio-xs" [name]="'ctype_' + $index" value="sensor" [(ngModel)]="ec.type" />
                    <span class="text-sm">Sensor field</span>
                  </label>
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input type="radio" class="radio radio-xs" [name]="'ctype_' + $index" value="control_state" [(ngModel)]="ec.type" />
                    <span class="text-sm">Control state</span>
                  </label>
                </div>
                @if (ec.type === 'sensor') {
                  <div class="flex flex-wrap gap-2 items-end">
                    <div class="form-control">
                      <label class="label text-xs py-0.5">Field</label>
                      <select class="select select-bordered select-sm" [(ngModel)]="ec.field_idx">
                        @for (f of fieldOptions(); track f.value) {
                          <option [value]="f.value">{{ f.label }}</option>
                        }
                      </select>
                    </div>
                    <div class="form-control">
                      <label class="label text-xs py-0.5">Operator</label>
                      <select class="select select-bordered select-sm w-20" [(ngModel)]="ec.operator">
                        @for (op of ops; track op) { <option [value]="op">{{ op }}</option> }
                      </select>
                    </div>
                    <div class="form-control">
                      <label class="label text-xs py-0.5">Threshold <span class="text-base-content/40">(0–255)</span></label>
                      <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="ec.threshold" min="0" max="255" step="1" />
                    </div>
                  </div>
                } @else {
                  <div class="flex flex-wrap gap-2 items-end">
                    <div class="form-control">
                      <label class="label text-xs py-0.5">Control</label>
                      <select class="select select-bordered select-sm" [(ngModel)]="ec.control_idx"
                        (ngModelChange)="ec.control_state = 0">
                        @for (c of controlOptions(); track c.value) {
                          <option [value]="c.value">{{ c.label }}</option>
                        }
                      </select>
                    </div>
                    <span class="self-end mb-2 text-sm text-base-content/50">equals</span>
                    <div class="form-control">
                      <label class="label text-xs py-0.5">State</label>
                      <select class="select select-bordered select-sm" [(ngModel)]="ec.control_state">
                        @for (s of stateOptionsFor(ec.control_idx); track s.value) {
                          <option [value]="s.value">{{ s.label }}</option>
                        }
                      </select>
                    </div>
                  </div>
                }
              </div>
            }
            @if (form.extra_conditions.length < 3) {
              <button class="btn btn-xs btn-ghost text-primary" (click)="addCondition()">+ Add condition</button>
            }
            @if (form.extra_conditions.length > 0) {
              <p class="text-xs text-base-content/40">Extra condition thresholds are integer-only (0–255). For fractional values use a server workflow.</p>
            }

            <!-- 3. Action -->
            <div class="space-y-2">
              <p class="text-xs font-semibold text-base-content/60 uppercase">Action</p>
              <div class="flex flex-wrap gap-2 items-end">
                <div class="form-control">
                  <label class="label text-xs py-0.5">Control</label>
                  <select class="select select-bordered select-sm" [(ngModel)]="form.control_idx"
                    (ngModelChange)="form.action_state = 0">
                    @for (c of controlOptions(); track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                    @if (controlOptions().length === 0) {
                      <option [value]="form.control_idx">control #{{ form.control_idx }}</option>
                    }
                  </select>
                </div>
                <span class="self-end mb-2 text-sm text-base-content/50">→</span>
                <div class="form-control">
                  <label class="label text-xs py-0.5">State</label>
                  <select class="select select-bordered select-sm" [(ngModel)]="form.action_state">
                    @for (s of stateOptionsFor(form.control_idx); track s.value) {
                      <option [value]="s.value">{{ s.label }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <!-- 4. Schedule (optional) -->
            <div class="space-y-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="checkbox checkbox-sm" [(ngModel)]="form.has_time" />
                <span class="text-xs font-semibold text-base-content/60 uppercase">Time window</span>
                <span class="text-xs text-base-content/40">(server-managed)</span>
              </label>
              @if (form.has_time) {
                <div class="pl-4 border-l-2 border-base-300 flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs py-0.5">From (hour)</label>
                    <select class="select select-bordered select-sm w-24" [(ngModel)]="form.time_start">
                      @for (h of hours; track h) { <option [value]="h">{{ padHour(h) }}:00</option> }
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs py-0.5">To (hour)</label>
                    <select class="select select-bordered select-sm w-24" [(ngModel)]="form.time_end">
                      @for (h of hours; track h) { <option [value]="h">{{ padHour(h) }}:00</option> }
                    </select>
                  </div>
                </div>
              }
            </div>

            <!-- 5. Priority & Cooldown -->
            <div class="space-y-2">
              <p class="text-xs font-semibold text-base-content/60 uppercase">Tuning</p>
              <div class="flex flex-wrap gap-2 items-end">
                <div class="form-control">
                  <label class="label text-xs py-0.5">Priority <span class="text-base-content/40">(0=highest)</span></label>
                  <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="form.priority" min="0" max="255" />
                </div>
                <div class="form-control">
                  <label class="label text-xs py-0.5">Cooldown (s)</label>
                  <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="form.cooldown_seconds" min="0" />
                </div>
                <div class="form-control self-end">
                  <label class="label cursor-pointer gap-2 pb-2">
                    <span class="text-xs">Enabled</span>
                    <input type="checkbox" class="toggle toggle-xs toggle-primary" [(ngModel)]="form.enabled" />
                  </label>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex gap-2 pt-1">
              <button class="btn btn-sm btn-primary" (click)="saveRule()" [disabled]="saving()">
                {{ saving() ? 'Saving…' : (editingId() ? 'Update rule' : 'Add rule') }}
              </button>
              @if (editingId()) {
                <button class="btn btn-sm btn-ghost" (click)="cancelEdit()">Cancel</button>
              }
            </div>

          </div>
        </div>
      </details>
    </div>
  `,
})
export class DeviceRulesSectionComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  fields = input<DeviceField[]>([]);
  controls = input<DeviceControl[]>([]);
  prefillForm = input<Partial<DeviceRuleRecord> | null>(null);

  rules = signal<DeviceRuleRecord[]>([]);
  loading = signal(false);
  saving = signal(false);
  pushing = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);
  editingId = signal<string | null>(null);

  form: RuleForm = defaultForm();

  readonly ops = OPS;
  readonly hours = Array.from({ length: 24 }, (_, i) => i);

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
    effect(() => {
      const eui = this.eui();
      if (!eui) { this.rules.set([]); return; }
      this.loading.set(true);
      this.api.getDeviceRules(eui).subscribe({
        next: (list) => { this.rules.set(list); this.loading.set(false); },
        error: () => { this.rules.set([]); this.loading.set(false); },
      });
    });
    effect(() => {
      const p = this.prefillForm();
      if (!p) return;
      this.editingId.set(null);
      this.form = {
        ...defaultForm(),
        field_idx:        p.field_idx        ?? defaultForm().field_idx,
        operator:         (p.operator as Op) ?? defaultForm().operator,
        threshold:        p.threshold        ?? defaultForm().threshold,
        control_idx:      p.control_idx      ?? defaultForm().control_idx,
        action_state:     p.action_state     ?? defaultForm().action_state,
        enabled:          p.enabled          ?? true,
      };
      this.message.set(null);
    });
  }

  // ── Name resolution helpers ──────────────────────────────────────────────

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
    if (c?.states_json?.length) {
      return c.states_json.map((s, i) => ({ value: i, label: s }));
    }
    return [{ value: 0, label: 'off' }, { value: 1, label: 'on' }];
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  padHour(h: number): string {
    return String(h).padStart(2, '0');
  }

  formatDuration(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    return `${(sec / 3600).toFixed(1)}h`;
  }

  // ── Condition management ────────────────────────────────────────────────

  addCondition(): void {
    if (this.form.extra_conditions.length < 3) {
      this.form.extra_conditions = [...this.form.extra_conditions, defaultCondition()];
    }
  }

  removeCondition(index: number): void {
    this.form.extra_conditions = this.form.extra_conditions.filter((_, i) => i !== index);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  startEdit(r: DeviceRuleRecord): void {
    this.editingId.set(r.id);
    this.form = {
      field_idx: r.field_idx,
      operator: r.operator as Op,
      threshold: r.threshold,
      control_idx: r.control_idx,
      action_state: r.action_state,
      priority: r.priority ?? 128,
      cooldown_seconds: r.cooldown_seconds ?? 300,
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
      has_time: ((r.time_start ?? -1) >= 0 && (r.time_end ?? -1) >= 0),
      time_start: r.time_start ?? 6,
      time_end: r.time_end ?? 18,
    };
    this.message.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form = defaultForm();
    this.message.set(null);
  }

  saveRule(): void {
    const eui = this.eui();
    if (!eui) return;
    this.saving.set(true);
    this.message.set(null);

    const extra_conditions: ExtraCondition[] = this.form.extra_conditions.map(ec => {
      const isControl = ec.type === 'control_state';
      return {
        field_idx: isControl ? ec.control_idx : ec.field_idx,
        operator: isControl ? '==' : ec.operator,
        threshold: isControl ? ec.control_state : ec.threshold,
        is_control: isControl,
        logic: ec.logic,
      };
    });

    const record: Partial<DeviceRuleRecord> = {
      device_eui: eui,
      rule_id: this.editingId() ? undefined : this.rules().length,
      field_idx: this.form.field_idx,
      operator: this.form.operator,
      threshold: this.form.threshold,
      control_idx: this.form.control_idx,
      action_state: this.form.action_state,
      priority: this.form.priority,
      cooldown_seconds: this.form.cooldown_seconds,
      enabled: this.form.enabled,
      extra_conditions,
      time_start: this.form.has_time ? this.form.time_start : -1,
      time_end: this.form.has_time ? this.form.time_end : -1,
      synced_at: '',
    };

    const id = this.editingId();
    const op$ = id
      ? this.api.updateDeviceRule(id, record)
      : this.api.createDeviceRule(record);

    op$.subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set(id ? 'Rule updated.' : 'Rule added.');
        this.saving.set(false);
        this.editingId.set(null);
        this.form = defaultForm();
        this.api.getDeviceRules(eui).subscribe((list) => this.rules.set(list));
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.message ?? err?.message ?? 'Failed to save rule');
        this.saving.set(false);
      },
    });
  }

  toggleEnabled(r: DeviceRuleRecord): void {
    this.api.updateDeviceRule(r.id, { enabled: r.enabled === false, synced_at: '' }).subscribe({
      next: () => this.api.getDeviceRules(this.eui()).subscribe((list) => this.rules.set(list)),
    });
  }

  deleteRule(id: string): void {
    this.api.deleteDeviceRule(id).subscribe({
      next: () => {
        this.rules.update((list) => list.filter((r) => r.id !== id));
        this.message.set(null);
      },
    });
  }

  pushRules(): void {
    const eui = this.eui();
    if (!eui) return;
    this.pushing.set(true);
    this.message.set(null);
    this.api.pushDeviceRules(eui).subscribe({
      next: (res) => {
        this.isError.set(false);
        this.message.set(`Pushed ${res.rules_pushed} rule${res.rules_pushed !== 1 ? 's' : ''} to device.`);
        this.pushing.set(false);
        this.api.getDeviceRules(eui).subscribe((list) => this.rules.set(list));
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? 'Push failed');
        this.pushing.set(false);
      },
    });
  }
}
