import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceControl, DeviceField, WorkflowAction, WorkflowRecord, WorkflowTrigger } from '../../core/services/api.service';
import { DeviceManagerService } from '../../core/services/device-manager.service';

@Component({
  selector: 'app-workflow-editor',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <!-- Breadcrumb -->
    <nav class="text-sm breadcrumbs px-0 mb-4">
      <ul>
        <li><a routerLink="/workflows">Workflows</a></li>
        <li>{{ isEdit() ? 'Edit: ' + form.name : 'New workflow' }}</li>
      </ul>
    </nav>

    <header class="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 class="page-title">{{ isEdit() ? 'Edit workflow' : 'New workflow' }}</h1>
        <p class="page-description">{{ isEdit() ? 'Update triggers, conditions, and actions.' : 'Define triggers, conditions, and actions for your automation.' }}</p>
      </div>
      <a routerLink="/workflows" class="btn btn-ghost btn-sm gap-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to list
      </a>
    </header>

    @if (loadError()) {
      <div class="alert alert-error rounded-xl mb-4"><span>{{ loadError() }}</span></div>
    }

    @if (message()) {
      <div class="alert text-sm rounded-xl mb-4" [class.alert-error]="msgIsError()" [class.alert-success]="!msgIsError()">
        <span>{{ message() }}</span>
      </div>
    }

    <div class="card-elevated">
      <div class="card-body-spaced">
        <div class="space-y-5">
          <!-- Name & description -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label text-xs font-medium">Name</label>
              <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.name" placeholder="e.g. High temp → pump on" />
            </div>
            <div class="form-control">
              <label class="label text-xs font-medium">Description</label>
              <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.description" placeholder="Optional" />
            </div>
          </div>

          <!-- Triggers -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Triggers (any one fires the workflow)</label>
              <button type="button" class="btn btn-ghost btn-xs" (click)="addTrigger()">+ Add</button>
            </div>
            @for (t of form.triggers; track $index; let i = $index) {
              <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs">Type</label>
                    <select class="select select-bordered select-sm" [(ngModel)]="t.type">
                      <option value="telemetry">Sensor reading</option>
                      <option value="state_change">State change</option>
                      <option value="checkin">Device checkin</option>
                      <option value="schedule">Schedule (cron)</option>
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs">Device</label>
                    <select class="select select-bordered select-sm w-44" [(ngModel)]="t.device_eui" (change)="onTriggerDeviceSelected(i)">
                      <option value="">Any device</option>
                      @for (dev of devices(); track dev.device_eui) {
                        <option [value]="dev.device_eui">{{ dev.device_name || dev.device_eui.slice(0, 8) }}</option>
                      }
                    </select>
                  </div>
                  @if (t.type === 'telemetry') {
                    <div class="form-control">
                      <label class="label text-xs">Field</label>
                      <select class="select select-bordered select-sm w-36" [(ngModel)]="t.field">
                        <option value="">Any field</option>
                        @for (field of (triggerDeviceFields().get(i) || []); track field.field_key) {
                          <option [value]="field.field_key">{{ field.display_name || field.field_key }}</option>
                        }
                      </select>
                    </div>
                  }
                  @if (t.type === 'state_change') {
                    <div class="form-control">
                      <label class="label text-xs">Control</label>
                      @if ((triggerDeviceControls().get(i) || []).length > 0) {
                        <select class="select select-bordered select-sm w-28" [(ngModel)]="t.control_key">
                          <option value="">Any control</option>
                          @for (ctrl of triggerDeviceControls().get(i)!; track ctrl.control_key) {
                            <option [value]="ctrl.control_key">{{ ctrl.display_name || ctrl.control_key }}</option>
                          }
                        </select>
                      } @else {
                        <input type="text" class="input input-bordered input-sm w-28" [(ngModel)]="t.control_key" placeholder="pump" />
                      }
                    </div>
                  }
                  @if (t.type === 'schedule') {
                    <div class="form-control">
                      <label class="label text-xs">Cron expression</label>
                      <input type="text" class="input input-bordered input-sm w-36 font-mono" [(ngModel)]="t.cron" placeholder="0 6 * * *" />
                      <span class="label-text-alt text-xs text-base-content/50 mt-0.5">min hour day month weekday</span>
                    </div>
                  }
                  @if (form.triggers.length > 1) {
                    <button type="button" class="btn btn-ghost btn-xs text-error self-end" (click)="removeTrigger(i)">Remove</button>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Condition -->
          <div class="form-control">
            <label class="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-1">Condition (optional)</label>
            <textarea class="textarea textarea-bordered textarea-sm font-mono text-xs" rows="2" [(ngModel)]="form.condition_expr"
              placeholder="e.g. temperature > 35 && hour >= 6"></textarea>
          </div>

          <!-- Actions -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Actions (executed in order)</label>
              <button type="button" class="btn btn-ghost btn-xs" (click)="addAction()">+ Add</button>
            </div>
            @for (a of form.actions; track $index; let i = $index) {
              <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs">Type</label>
                    <select class="select select-bordered select-sm" [(ngModel)]="a.type">
                      <option value="set_control">Set control</option>
                      <option value="send_command">Send command</option>
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs">Target device</label>
                    <select class="select select-bordered select-sm w-44" [(ngModel)]="a.target_eui" (change)="onActionDeviceSelected(i)">
                      <option value="">Select device...</option>
                      @for (dev of devices(); track dev.device_eui) {
                        <option [value]="dev.device_eui">{{ dev.device_name || dev.device_eui.slice(0, 8) }}</option>
                      }
                    </select>
                  </div>
                  @if (a.type === 'set_control') {
                    <div class="form-control">
                      <label class="label text-xs">Control</label>
                      @if ((actionDeviceControls().get(i) || []).length > 0) {
                        <select class="select select-bordered select-sm w-28" [(ngModel)]="a.control" (change)="onActionControlSelected(i)">
                          <option value="">Select...</option>
                          @for (ctrl of actionDeviceControls().get(i)!; track ctrl.control_key) {
                            <option [value]="ctrl.control_key">{{ ctrl.display_name || ctrl.control_key }}</option>
                          }
                        </select>
                      } @else {
                        <input type="text" class="input input-bordered input-sm w-28" [(ngModel)]="a.control" placeholder="pump" />
                      }
                    </div>
                    <div class="form-control">
                      <label class="label text-xs">State</label>
                      @if ((actionControlStates().get(i) || []).length > 0) {
                        <select class="select select-bordered select-sm w-24" [(ngModel)]="a.state">
                          @for (s of actionControlStates().get(i)!; track s) {
                            <option [value]="s">{{ s }}</option>
                          }
                        </select>
                      } @else {
                        <input type="text" class="input input-bordered input-sm w-24" [(ngModel)]="a.state" placeholder="on" />
                      }
                    </div>
                    <div class="form-control">
                      <label class="label text-xs">Duration (s)</label>
                      <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="a.duration" min="0" />
                    </div>
                  }
                  @if (a.type === 'send_command') {
                    <div class="form-control">
                      <label class="label text-xs">Command</label>
                      <input type="text" class="input input-bordered input-sm w-28" [(ngModel)]="a.command" placeholder="interval" />
                    </div>
                    <div class="form-control">
                      <label class="label text-xs">Value</label>
                      <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="a.value" />
                    </div>
                  }
                  @if (form.actions.length > 1) {
                    <button type="button" class="btn btn-ghost btn-xs text-error self-end" (click)="removeAction(i)">Remove</button>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Settings & submit -->
          <div class="flex flex-wrap gap-3 items-end border-t border-base-300 pt-4">
            <div class="form-control">
              <label class="label text-xs">Cooldown (s)</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.cooldown_seconds" min="0" />
            </div>
            <div class="form-control">
              <label class="label text-xs">Priority</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.priority" />
            </div>
            <div class="flex-1"></div>
            <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : (isEdit() ? 'Save changes' : 'Create workflow') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class WorkflowEditorComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private deviceManager = inject(DeviceManagerService);

  devices = computed(() => this.deviceManager.devices());

  isEdit = signal(false);
  workflowId = signal<string | null>(null);
  loadError = signal<string | null>(null);
  saving = signal(false);
  message = signal<string | null>(null);
  msgIsError = signal(false);

  // Track available fields/controls per trigger/action index
  triggerDeviceFields = signal<Map<number, DeviceField[]>>(new Map());
  triggerDeviceControls = signal<Map<number, DeviceControl[]>>(new Map());
  actionDeviceControls = signal<Map<number, DeviceControl[]>>(new Map());
  actionControlStates = signal<Map<number, string[]>>(new Map());

  form = this.emptyForm();

  private emptyForm() {
    return {
      name: '',
      description: '',
      condition_expr: '',
      cooldown_seconds: 300,
      priority: 100,
      triggers: [{ type: 'telemetry' as 'telemetry' | 'state_change' | 'checkin' | 'schedule', device_eui: '', field: '', control_key: '', cron: '' }],
      actions: [{ type: 'set_control' as 'set_control' | 'send_command', target_eui: '', control: '', state: '', duration: 0, command: '', value: null as number | null }],
    };
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEdit.set(true);
      this.workflowId.set(id);
      this.loadWorkflow(id);
    }
  }

  private loadWorkflow(id: string): void {
    this.api.getWorkflows().subscribe({
      next: (list) => {
        const wf = list.find(w => w.id === id);
        if (!wf) {
          this.loadError.set('Workflow not found.');
          return;
        }
        this.populateForm(wf);
      },
      error: (err) => this.loadError.set(err?.message ?? 'Failed to load workflow'),
    });
  }

  private populateForm(wf: WorkflowRecord): void {
    this.form.name = wf.name;
    this.form.description = wf.description || '';
    this.form.condition_expr = wf.condition_expr || '';
    this.form.cooldown_seconds = wf.cooldown_seconds ?? 300;
    this.form.priority = wf.priority ?? 100;

    this.form.triggers = (wf.triggers || []).map(t => ({
      type: t.type as 'telemetry' | 'state_change' | 'checkin' | 'schedule',
      device_eui: t.filter?.device_eui || '',
      field: t.filter?.field || '',
      control_key: t.filter?.control_key || '',
      cron: t.cron || '',
    }));
    if (this.form.triggers.length === 0) {
      this.form.triggers = [{ type: 'telemetry', device_eui: '', field: '', control_key: '', cron: '' }];
    }

    this.form.actions = (wf.actions || []).map(a => ({
      type: a.type as 'set_control' | 'send_command',
      target_eui: a.target_eui || '',
      control: a.control || '',
      state: a.state || '',
      duration: a.duration || 0,
      command: a.command || '',
      value: a.value ?? null,
    }));
    if (this.form.actions.length === 0) {
      this.form.actions = [{ type: 'set_control', target_eui: '', control: '', state: '', duration: 0, command: '', value: null }];
    }

    // Load fields/controls for pre-populated devices
    this.form.triggers.forEach((t, i) => {
      if (t.device_eui) this.loadTriggerDeviceData(i, t.device_eui);
    });
    this.form.actions.forEach((a, i) => {
      if (a.target_eui) this.loadActionDeviceData(i, a.target_eui);
    });
  }

  // ─── Triggers ─────────────────────────────────────────

  addTrigger(): void {
    this.form.triggers = [...this.form.triggers, { type: 'telemetry', device_eui: '', field: '', control_key: '', cron: '' }];
  }

  removeTrigger(i: number): void {
    this.form.triggers = this.form.triggers.filter((_, idx) => idx !== i);
    this.triggerDeviceFields.update(m => { m.delete(i); return new Map(m); });
    this.triggerDeviceControls.update(m => { m.delete(i); return new Map(m); });
  }

  async onTriggerDeviceSelected(triggerIndex: number): Promise<void> {
    const trigger = this.form.triggers[triggerIndex];
    if (!trigger.device_eui) {
      this.triggerDeviceFields.update(m => { m.delete(triggerIndex); return new Map(m); });
      this.triggerDeviceControls.update(m => { m.delete(triggerIndex); return new Map(m); });
      trigger.field = '';
      trigger.control_key = '';
      return;
    }
    this.loadTriggerDeviceData(triggerIndex, trigger.device_eui);
  }

  private async loadTriggerDeviceData(index: number, eui: string): Promise<void> {
    try {
      const fields = await this.deviceManager.getDeviceFields(eui);
      this.triggerDeviceFields.update(m => { m.set(index, fields); return new Map(m); });
    } catch { /* ignore */ }
    try {
      const controls = await this.deviceManager.getDeviceControls(eui);
      this.triggerDeviceControls.update(m => { m.set(index, controls); return new Map(m); });
    } catch { /* ignore */ }
  }

  // ─── Actions ──────────────────────────────────────────

  addAction(): void {
    this.form.actions = [...this.form.actions, { type: 'set_control', target_eui: '', control: '', state: '', duration: 0, command: '', value: null }];
  }

  removeAction(i: number): void {
    this.form.actions = this.form.actions.filter((_, idx) => idx !== i);
    this.actionDeviceControls.update(m => { m.delete(i); return new Map(m); });
    this.actionControlStates.update(m => { m.delete(i); return new Map(m); });
  }

  async onActionDeviceSelected(actionIndex: number): Promise<void> {
    const action = this.form.actions[actionIndex];
    if (!action.target_eui) {
      this.actionDeviceControls.update(m => { m.delete(actionIndex); return new Map(m); });
      this.actionControlStates.update(m => { m.delete(actionIndex); return new Map(m); });
      action.control = '';
      action.state = '';
      return;
    }
    this.loadActionDeviceData(actionIndex, action.target_eui);
  }

  private async loadActionDeviceData(index: number, eui: string): Promise<void> {
    try {
      const controls = await this.deviceManager.getDeviceControls(eui);
      this.actionDeviceControls.update(m => { m.set(index, controls); return new Map(m); });
    } catch { /* ignore */ }
  }

  onActionControlSelected(actionIndex: number): void {
    const action = this.form.actions[actionIndex];
    const controls = this.actionDeviceControls().get(actionIndex) || [];
    const ctrl = controls.find(c => c.control_key === action.control);
    if (ctrl?.states_json && Array.isArray(ctrl.states_json)) {
      this.actionControlStates.update(m => { m.set(actionIndex, ctrl.states_json as string[]); return new Map(m); });
    } else {
      this.actionControlStates.update(m => { m.delete(actionIndex); return new Map(m); });
    }
  }

  // ─── Save ─────────────────────────────────────────────

  save(): void {
    this.saving.set(true);
    this.message.set(null);

    const triggers: WorkflowTrigger[] = this.form.triggers.map(t => {
      const filter: Record<string, string> = {};
      if (t.device_eui) filter['device_eui'] = t.device_eui;
      if (t.type === 'telemetry' && t.field) filter['field'] = t.field;
      if (t.type === 'state_change' && t.control_key) filter['control_key'] = t.control_key;
      const trigger: WorkflowTrigger = { type: t.type, filter: Object.keys(filter).length > 0 ? filter : undefined };
      if (t.type === 'schedule' && t.cron) trigger.cron = t.cron;
      return trigger;
    });

    const actions: WorkflowAction[] = this.form.actions.map(a => {
      if (a.type === 'set_control') {
        return { type: 'set_control', target_eui: a.target_eui, control: a.control, state: a.state, duration: a.duration || undefined } as WorkflowAction;
      }
      return { type: 'send_command', target_eui: a.target_eui, command: a.command, value: a.value ?? undefined } as WorkflowAction;
    });

    const record: Partial<WorkflowRecord> = {
      name: this.form.name,
      description: this.form.description || undefined,
      enabled: true,
      triggers,
      condition_expr: this.form.condition_expr,
      actions,
      cooldown_seconds: this.form.cooldown_seconds,
      priority: this.form.priority,
    };

    const obs = this.isEdit()
      ? this.api.updateWorkflow(this.workflowId()!, record)
      : this.api.createWorkflow(record);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/workflows']);
      },
      error: (err) => {
        this.msgIsError.set(true);
        this.message.set(err?.error?.message ?? err?.error?.error ?? err?.message ?? 'Failed to save');
        this.saving.set(false);
      },
    });
  }
}
