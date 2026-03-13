import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, DeviceField, WorkflowAction, WorkflowLogRecord, WorkflowRecord, WorkflowTrigger } from '../../core/services/api.service';
import { DeviceManagerService } from '../../core/services/device-manager.service';

@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Workflows</h1>
      <p class="page-description">Server-side automation pipelines. Each workflow defines triggers, conditions, and actions across any device.</p>
    </header>

    @if (message()) {
      <div class="alert text-sm rounded-xl mb-4" [class.alert-error]="isError()" [class.alert-success]="!isError()">
        <span>{{ message() }}</span>
      </div>
    }

    <!-- Workflow list -->
    @if (workflows().length === 0 && !loading()) {
      <div class="card-elevated">
        <div class="card-body-spaced text-center py-12">
          <p class="text-base-content/50">No workflows yet. Create your first workflow below.</p>
        </div>
      </div>
    } @else {
      <div class="space-y-3 mb-6">
        @for (w of workflows(); track w.id) {
          <div class="card-elevated overflow-hidden">
            <!-- Header row -->
            <div class="flex items-center gap-3 px-5 py-3.5">
              <input type="checkbox" class="toggle toggle-sm toggle-success" [checked]="w.enabled" (change)="toggleEnabled(w)" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{{ w.name }}</div>
                @if (w.description) {
                  <div class="text-xs text-base-content/50 truncate">{{ w.description }}</div>
                }
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                @if (w.cooldown_seconds) {
                  <span class="badge badge-xs badge-ghost">{{ w.cooldown_seconds }}s</span>
                }
                @if (w.priority) {
                  <span class="badge badge-xs badge-ghost">p{{ w.priority }}</span>
                }
                <button class="btn btn-ghost btn-xs" (click)="testWorkflow(w)" [disabled]="testing()">Test</button>
                <button class="btn btn-ghost btn-xs text-error" (click)="deleteWorkflow(w)">Delete</button>
              </div>
            </div>

            <!-- Pipeline visualization -->
            <div class="border-t border-base-200 bg-base-200/20 px-5 py-2.5">
              <div class="flex items-center gap-2 flex-wrap text-xs">
                @for (t of w.triggers; track $index) {
                  <span class="badge badge-sm badge-outline badge-info gap-1">
                    {{ t.type === 'telemetry' ? 'Sensor' : 'State change' }}
                    @if (t.filter?.device_eui) {
                      <a [routerLink]="['/device', t.filter!.device_eui!]" class="font-mono link link-hover">{{ t.filter!.device_eui!.slice(0, 8) }}</a>
                    }
                    @if (t.filter?.field) { <span>· {{ t.filter!.field }}</span> }
                    @if (t.filter?.control_key) { <span>· {{ t.filter!.control_key }}</span> }
                  </span>
                  @if ($index < w.triggers.length - 1) {
                    <span class="text-base-content/30 font-bold">OR</span>
                  }
                }

                <span class="text-base-content/30">→</span>

                @if (w.condition_expr) {
                  <span class="badge badge-sm badge-outline badge-warning font-mono truncate max-w-48" [title]="w.condition_expr">{{ w.condition_expr }}</span>
                  <span class="text-base-content/30">→</span>
                }

                @for (a of w.actions; track $index) {
                  <span class="badge badge-sm gap-1" [class.badge-primary]="a.type === 'set_control'" [class.badge-secondary]="a.type === 'send_command'">
                    {{ a.type === 'set_control' ? a.control + '=' + a.state : a.command }}
                    @if (a.target_eui) {
                      <a [routerLink]="['/device', a.target_eui]" class="font-mono link link-hover opacity-70">{{ a.target_eui.slice(0, 8) }}</a>
                    }
                  </span>
                  @if ($index < w.actions.length - 1) {
                    <span class="text-base-content/30">then</span>
                  }
                }
              </div>
            </div>

            <!-- Test result -->
            @if (testResult()?.workflowId === w.id) {
              <div class="border-t border-base-200 bg-base-200/30 px-5 py-2">
                <div class="text-xs space-y-1">
                  <div>
                    <span class="font-semibold">Condition:</span>
                    <span class="ml-1" [class.text-success]="testResult()!.conditionResult" [class.text-error]="!testResult()!.conditionResult">
                      {{ testResult()!.conditionResult ? 'TRUE' : 'FALSE' }}
                    </span>
                    @if (testResult()!.cooldownActive) {
                      <span class="badge badge-xs badge-warning ml-2">cooldown active</span>
                    }
                  </div>
                  <div><span class="font-semibold">Would fire:</span> {{ testResult()!.wouldFire ? 'Yes' : 'No' }}</div>
                  @if (testResult()!.error) {
                    <div class="text-error"><span class="font-semibold">Error:</span> {{ testResult()!.error }}</div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    }

    <!-- Recent activity -->
    @if (logEntries().length > 0) {
      <details class="collapse collapse-arrow border border-base-200 rounded-xl bg-base-100 mb-6">
        <summary class="collapse-title text-sm font-semibold py-2 min-h-0">Recent activity ({{ logEntries().length }})</summary>
        <div class="collapse-content px-2 pb-2">
          <div class="overflow-x-auto">
            <table class="table table-xs">
              <thead>
                <tr class="bg-base-200/40">
                  <th>Time</th>
                  <th>Workflow</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th>Actions</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                @for (l of logEntries(); track l.id) {
                  <tr>
                    <td class="text-xs">{{ l.ts | date:'short' }}</td>
                    <td class="text-xs">{{ l.workflow_name || l.workflow_id.slice(0, 8) }}</td>
                    <td class="font-mono text-xs">
                      @if (l.trigger_device) {
                        <a [routerLink]="['/device', l.trigger_device]" class="link link-hover">{{ l.trigger_device.slice(0, 8) }}</a>
                      }
                    </td>
                    <td>
                      <span class="badge badge-xs"
                        [class.badge-success]="l.status === 'fired'"
                        [class.badge-warning]="l.status === 'skipped_cooldown'"
                        [class.badge-error]="l.status === 'error'"
                        [class.badge-ghost]="l.status !== 'fired' && l.status !== 'skipped_cooldown' && l.status !== 'error'"
                      >{{ l.status }}</span>
                    </td>
                    <td class="text-xs">{{ l.actions_completed ?? 0 }}</td>
                    <td class="text-xs text-error max-w-32 truncate">{{ l.error_message }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </details>
    }

    <!-- Create workflow form -->
    <div class="card-elevated">
      <div class="card-body-spaced">
        <h2 class="section-title">Create workflow</h2>
        <div class="space-y-4">
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
              <button type="button" class="btn btn-ghost btn-xs" (click)="addTrigger()">+ Add trigger</button>
            </div>
            @for (t of form.triggers; track $index; let i = $index) {
              <div class="space-y-2 rounded-lg border border-base-300 bg-base-200/30 p-3">
                <div class="flex flex-wrap gap-2 items-end">
                  <div class="form-control">
                    <label class="label text-xs">Type</label>
                    <select class="select select-bordered select-sm" [(ngModel)]="t.type">
                      <option value="telemetry">Sensor reading</option>
                      <option value="state_change">State change</option>
                    </select>
                  </div>
                  <div class="form-control">
                    <label class="label text-xs">Device (optional)</label>
                    <select class="select select-bordered select-sm w-44" [(ngModel)]="t.device_eui" (change)="onTriggerDeviceSelected(i)">
                      <option value="">Any device</option>
                      @for (dev of devices(); track dev.device_eui) {
                        <option [value]="dev.device_eui">{{ dev.device_name || dev.device_eui.slice(0, 8) }}</option>
                      }
                    </select>
                  </div>
                  @if (t.type === 'telemetry') {
                    <div class="form-control">
                      <label class="label text-xs">Field (optional)</label>
                      <select class="select select-bordered select-sm w-32" [(ngModel)]="t.field">
                        <option value="">Any field</option>
                        @for (field of (triggerDeviceFields().get(i) || []); track field.field_key) {
                          <option [value]="field.field_key">{{ field.display_name || field.field_key }}</option>
                        }
                      </select>
                    </div>
                  }
                  @if (t.type === 'state_change') {
                    <div class="form-control">
                      <label class="label text-xs">Control (optional)</label>
                      <input type="text" class="input input-bordered input-sm w-28" [(ngModel)]="t.control_key" placeholder="pump" />
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
              <button type="button" class="btn btn-ghost btn-xs" (click)="addAction()">+ Add action</button>
            </div>
            @for (a of form.actions; track $index; let i = $index) {
              <div class="space-y-2 rounded-lg border border-base-300 bg-base-200/30 p-3">
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
                      <input type="text" class="input input-bordered input-sm w-28" [(ngModel)]="a.control" placeholder="pump" />
                    </div>
                    <div class="form-control">
                      <label class="label text-xs">State</label>
                      <input type="text" class="input input-bordered input-sm w-24" [(ngModel)]="a.state" placeholder="on" />
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

          <!-- Settings -->
          <div class="flex flex-wrap gap-3 items-end pt-2">
            <div class="form-control">
              <label class="label text-xs">Cooldown (s)</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.cooldown_seconds" min="0" />
            </div>
            <div class="form-control">
              <label class="label text-xs">Priority</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.priority" />
            </div>
            <button type="button" class="btn btn-sm btn-primary" (click)="createWorkflow()" [disabled]="saving()">Create workflow</button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class WorkflowsComponent implements OnInit {
  private api = inject(ApiService);
  private deviceManager = inject(DeviceManagerService);

  workflows = signal<WorkflowRecord[]>([]);
  logEntries = signal<WorkflowLogRecord[]>([]);
  loading = signal(false);
  saving = signal(false);
  testing = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);
  testResult = signal<{ workflowId: string; conditionResult: boolean; wouldFire: boolean; cooldownActive: boolean; error?: string } | null>(null);

  // Device management
  devices = computed(() => this.deviceManager.devices());

  // Track available fields for each trigger/action based on device selection
  triggerDeviceFields = signal<Map<number, DeviceField[]>>(new Map());
  actionDeviceFields = signal<Map<number, DeviceField[]>>(new Map());

  // Comparison operators for conditions
  comparisonOperators = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in'];

  form = {
    name: '',
    description: '',
    condition_expr: '',
    cooldown_seconds: 300,
    priority: 100,
    triggers: [{ type: 'telemetry' as 'telemetry' | 'state_change', device_eui: '', field: '', control_key: '' }],
    actions: [{ type: 'set_control' as 'set_control' | 'send_command', target_eui: '', control: '', state: '', duration: 0, command: '', value: null as number | null }],
  };

  ngOnInit(): void {
    this.refreshList();
  }

  addTrigger(): void {
    this.form.triggers = [...this.form.triggers, { type: 'telemetry', device_eui: '', field: '', control_key: '' }];
  }

  removeTrigger(i: number): void {
    this.form.triggers = this.form.triggers.filter((_, idx) => idx !== i);
    this.triggerDeviceFields.update(m => {
      m.delete(i);
      return m;
    });
  }

  addAction(): void {
    this.form.actions = [...this.form.actions, { type: 'set_control', target_eui: '', control: '', state: '', duration: 0, command: '', value: null }];
  }

  removeAction(i: number): void {
    this.form.actions = this.form.actions.filter((_, idx) => idx !== i);
    this.actionDeviceFields.update(m => {
      m.delete(i);
      return m;
    });
  }

  /**
   * Handle trigger device selection - load available fields
   */
  async onTriggerDeviceSelected(triggerIndex: number): Promise<void> {
    const trigger = this.form.triggers[triggerIndex];
    if (!trigger.device_eui) {
      this.triggerDeviceFields.update(m => {
        m.delete(triggerIndex);
        return m;
      });
      trigger.field = '';
      trigger.control_key = '';
      return;
    }

    try {
      const fields = await this.deviceManager.getDeviceFields(trigger.device_eui);
      this.triggerDeviceFields.update(m => {
        m.set(triggerIndex, fields);
        return m;
      });
    } catch (err) {
      console.error('Failed to load fields for device:', err);
    }
  }

  /**
   * Handle action device selection - load available controls and fields
   */
  async onActionDeviceSelected(actionIndex: number): Promise<void> {
    const action = this.form.actions[actionIndex];
    if (!action.target_eui) {
      this.actionDeviceFields.update(m => {
        m.delete(actionIndex);
        return m;
      });
      action.control = '';
      return;
    }

    try {
      const fields = await this.deviceManager.getDeviceFields(action.target_eui);
      this.actionDeviceFields.update(m => {
        m.set(actionIndex, fields);
        return m;
      });
    } catch (err) {
      console.error('Failed to load fields for device:', err);
    }
  }

  toggleEnabled(w: WorkflowRecord): void {
    this.api.updateWorkflow(w.id, { enabled: !w.enabled }).subscribe({
      next: () => this.refreshList(),
      error: (err) => { this.isError.set(true); this.message.set(err?.error?.message ?? 'Failed to toggle'); },
    });
  }

  deleteWorkflow(w: WorkflowRecord): void {
    if (!confirm(`Delete workflow "${w.name}"?`)) return;
    this.api.deleteWorkflow(w.id).subscribe({
      next: () => { this.isError.set(false); this.message.set('Workflow deleted.'); this.refreshList(); },
      error: (err) => { this.isError.set(true); this.message.set(err?.error?.message ?? 'Failed to delete'); },
    });
  }

  testWorkflow(w: WorkflowRecord): void {
    this.testing.set(true);
    this.testResult.set(null);
    const mockData: Record<string, unknown> = { trigger_index: 0 };
    const firstTrigger = w.triggers?.[0];
    if (firstTrigger?.type === 'state_change') {
      mockData['mock_device_eui'] = firstTrigger.filter?.device_eui || '';
      mockData['mock_control'] = firstTrigger.filter?.control_key || 'pump';
      mockData['mock_new_state'] = 'on';
      mockData['mock_old_state'] = 'off';
    } else {
      mockData['mock_telemetry'] = {};
      mockData['mock_device_eui'] = firstTrigger?.filter?.device_eui || '';
    }
    this.api.testWorkflow(w.id, mockData).subscribe({
      next: (res) => {
        this.testResult.set({
          workflowId: w.id,
          conditionResult: res.condition_result,
          wouldFire: res.would_fire,
          cooldownActive: !!(res as Record<string, unknown>)['cooldown_active'],
          error: (res as Record<string, unknown>)['error'] as string | undefined,
        });
        this.testing.set(false);
      },
      error: (err) => {
        this.testResult.set({ workflowId: w.id, conditionResult: false, wouldFire: false, cooldownActive: false, error: err?.error?.message ?? 'Test failed' });
        this.testing.set(false);
      },
    });
  }

  createWorkflow(): void {
    this.saving.set(true);
    this.message.set(null);

    const triggers: WorkflowTrigger[] = this.form.triggers.map((t) => {
      const filter: Record<string, string> = {};
      if (t.device_eui) filter['device_eui'] = t.device_eui;
      if (t.type === 'telemetry' && t.field) filter['field'] = t.field;
      if (t.type === 'state_change' && t.control_key) filter['control_key'] = t.control_key;
      return { type: t.type, filter: Object.keys(filter).length > 0 ? filter : undefined } as WorkflowTrigger;
    });

    const actions: WorkflowAction[] = this.form.actions.map((a) => {
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

    this.api.createWorkflow(record).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Workflow created.');
        this.saving.set(false);
        this.form.name = '';
        this.form.description = '';
        this.form.condition_expr = '';
        this.refreshList();
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.message ?? err?.error?.error ?? err?.message ?? 'Failed to create');
        this.saving.set(false);
      },
    });
  }

  private refreshList(): void {
    this.loading.set(true);
    this.api.getWorkflows().subscribe({
      next: (list) => { this.workflows.set(list); this.loading.set(false); },
      error: () => { this.workflows.set([]); this.loading.set(false); },
    });
    this.api.getWorkflowLog(undefined, 30).subscribe({
      next: (logs) => this.logEntries.set(logs),
      error: () => this.logEntries.set([]),
    });
  }
}
