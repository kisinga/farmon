import { Component, input, signal, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, SlicePipe } from '@angular/common';
import { ApiService, AutomationRecord, AutomationLogRecord } from '../../../core/services/api.service';

@Component({
  selector: 'app-automations-section',
  standalone: true,
  template: `
    <div class="space-y-4">
      <h2 class="section-title">Server automations</h2>
      @if (message()) {
        <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
          <span>{{ message() }}</span>
        </div>
      }
      @if (automations().length === 0 && !loading()) {
        <p class="text-sm text-base-content/60">No server automations. Add one below.</p>
      } @else if (automations().length > 0) {
        <div class="overflow-x-auto rounded-xl border border-base-200">
          <table class="table table-sm">
            <thead>
              <tr class="bg-base-200/60">
                <th class="font-semibold">Name</th>
                <th class="font-semibold">Trigger</th>
                <th class="font-semibold">Condition</th>
                <th class="font-semibold">Action</th>
                <th class="font-semibold">Cooldown</th>
                <th class="font-semibold">Enabled</th>
                <th class="font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              @for (a of automations(); track a.id) {
                <tr>
                  <td class="font-medium">{{ a.name }}</td>
                  <td>
                    <span class="badge badge-sm badge-ghost">{{ a.trigger_type }}</span>
                    @if (a.trigger_device) {
                      <span class="text-xs text-base-content/50 ml-1 font-mono">{{ a.trigger_device | slice:0:8 }}</span>
                    }
                  </td>
                  <td class="font-mono text-xs max-w-48 truncate" [title]="a.condition_expr">{{ a.condition_expr }}</td>
                  <td>
                    <span class="badge badge-sm" [class.badge-primary]="a.action_type === 'setControl'" [class.badge-secondary]="a.action_type === 'sendCommand'">{{ a.action_type }}</span>
                    <span class="text-xs text-base-content/50 ml-1">{{ actionSummary(a) }}</span>
                  </td>
                  <td>{{ a.cooldown_seconds || 0 }}s</td>
                  <td>
                    <input type="checkbox" class="toggle toggle-sm toggle-success" [checked]="a.enabled" (change)="toggleEnabled(a)" />
                  </td>
                  <td class="flex gap-1">
                    <button class="btn btn-ghost btn-xs" (click)="testRule(a)" [disabled]="testing()">Test</button>
                    <button class="btn btn-ghost btn-xs text-error" (click)="deleteRule(a)">Del</button>
                  </td>
                </tr>
                @if (testResult()?.ruleId === a.id) {
                  <tr>
                    <td colspan="7" class="bg-base-200/30">
                      <div class="text-xs space-y-1 p-1">
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
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Recent log -->
      @if (logEntries().length > 0) {
        <details class="collapse collapse-arrow border border-base-200 rounded-xl bg-base-100">
          <summary class="collapse-title text-sm font-semibold py-2 min-h-0">Recent activity ({{ logEntries().length }})</summary>
          <div class="collapse-content px-2 pb-2">
            <div class="overflow-x-auto">
              <table class="table table-xs">
                <thead>
                  <tr class="bg-base-200/40">
                    <th>Time</th>
                    <th>Rule</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of logEntries(); track l.id) {
                    <tr>
                      <td class="text-xs">{{ l.ts | date:'short' }}</td>
                      <td class="text-xs">{{ l.automation_name || l.automation_id.slice(0, 8) }}</td>
                      <td class="font-mono text-xs">{{ l.trigger_device?.slice(0, 8) }}</td>
                      <td>
                        <span class="badge badge-xs"
                          [class.badge-success]="l.status === 'fired'"
                          [class.badge-warning]="l.status === 'skipped_cooldown'"
                          [class.badge-error]="l.status === 'error'"
                          [class.badge-ghost]="l.status !== 'fired' && l.status !== 'skipped_cooldown' && l.status !== 'error'"
                        >{{ l.status }}</span>
                      </td>
                      <td class="text-xs text-error max-w-32 truncate">{{ l.error_message }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </details>
      }

      <!-- Add form -->
      <div class="rounded-xl border border-base-200 bg-base-200/30 p-4 space-y-3">
        <h3 class="text-sm font-semibold">Add automation</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label text-xs">Name</label>
            <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.name" placeholder="e.g. High pulse → pump on" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Trigger type</label>
            <select class="select select-bordered select-sm" [(ngModel)]="form.trigger_type">
              <option value="telemetry">Telemetry</option>
              <option value="state_change">State change</option>
            </select>
          </div>
          <div class="form-control sm:col-span-2">
            <label class="label text-xs">Condition expression</label>
            <textarea class="textarea textarea-bordered textarea-sm font-mono text-xs" rows="2" [(ngModel)]="form.condition_expr"
              [placeholder]="form.trigger_type === 'telemetry' ? 'e.g. pd > 80 && hour >= 6' : 'e.g. new_state == &quot;on&quot; && control_key == &quot;pump&quot;'"></textarea>
          </div>
          <div class="form-control">
            <label class="label text-xs">Action type</label>
            <select class="select select-bordered select-sm" [(ngModel)]="form.action_type">
              <option value="setControl">Set control</option>
              <option value="sendCommand">Send command</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label text-xs">Target device EUI</label>
            <input type="text" class="input input-bordered input-sm font-mono" [(ngModel)]="form.target_eui" placeholder="target device EUI" />
          </div>
          @if (form.action_type === 'setControl') {
            <div class="form-control">
              <label class="label text-xs">Control key</label>
              <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.control" placeholder="e.g. pump" />
            </div>
            <div class="form-control">
              <label class="label text-xs">State</label>
              <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.state" placeholder="e.g. on" />
            </div>
            <div class="form-control">
              <label class="label text-xs">Duration (s, 0 = forever)</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.duration" min="0" />
            </div>
          }
          @if (form.action_type === 'sendCommand') {
            <div class="form-control">
              <label class="label text-xs">Command</label>
              <input type="text" class="input input-bordered input-sm" [(ngModel)]="form.command" placeholder="e.g. interval" />
            </div>
            <div class="form-control">
              <label class="label text-xs">Value (optional)</label>
              <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.commandValue" />
            </div>
          }
          <div class="form-control">
            <label class="label text-xs">Cooldown (s)</label>
            <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.cooldown_seconds" min="0" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Priority</label>
            <input type="number" class="input input-bordered input-sm w-28" [(ngModel)]="form.priority" />
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-primary" (click)="addAutomation()" [disabled]="saving()">Add automation</button>
      </div>
    </div>
  `,
  imports: [FormsModule, DatePipe, SlicePipe],
})
export class AutomationsSectionComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  automations = signal<AutomationRecord[]>([]);
  logEntries = signal<AutomationLogRecord[]>([]);
  loading = signal(false);
  saving = signal(false);
  testing = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);
  testResult = signal<{ ruleId: string; conditionResult: boolean; wouldFire: boolean; cooldownActive: boolean; error?: string } | null>(null);

  form = {
    name: '',
    trigger_type: 'telemetry' as 'telemetry' | 'state_change',
    condition_expr: '',
    action_type: 'setControl' as 'setControl' | 'sendCommand',
    target_eui: '',
    control: '',
    state: '',
    duration: 0,
    command: '',
    commandValue: null as number | null,
    cooldown_seconds: 300,
    priority: 100,
  };

  constructor() {
    effect(() => {
      const eui = this.eui();
      if (!eui) {
        this.automations.set([]);
        this.logEntries.set([]);
        return;
      }
      this.loading.set(true);
      this.form.target_eui = eui;
      this.api.getAutomations(eui).subscribe({
        next: (list) => {
          this.automations.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.automations.set([]);
          this.loading.set(false);
        },
      });
      this.api.getAutomationLog(undefined, 20).subscribe({
        next: (logs) => this.logEntries.set(logs),
        error: () => this.logEntries.set([]),
      });
    });
  }

  actionSummary(a: AutomationRecord): string {
    const cfg = a.action_config || {};
    if (a.action_type === 'setControl') {
      return `${cfg['control'] || '?'}=${cfg['state'] || '?'}`;
    }
    return `${cfg['command'] || '?'}`;
  }

  toggleEnabled(a: AutomationRecord): void {
    this.api.updateAutomation(a.id, { enabled: !a.enabled }).subscribe({
      next: () => this.refreshList(),
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.message ?? 'Failed to toggle');
      },
    });
  }

  deleteRule(a: AutomationRecord): void {
    if (!confirm(`Delete automation "${a.name}"?`)) return;
    this.api.deleteAutomation(a.id).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Automation deleted.');
        this.refreshList();
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.message ?? 'Failed to delete');
      },
    });
  }

  testRule(a: AutomationRecord): void {
    this.testing.set(true);
    this.testResult.set(null);
    const mockData: Record<string, unknown> = {};
    if (a.trigger_type === 'telemetry') {
      mockData['mock_telemetry'] = {};
      mockData['mock_device_eui'] = a.trigger_device || this.eui();
    } else {
      mockData['mock_device_eui'] = a.trigger_device || this.eui();
      mockData['mock_control'] = 'pump';
      mockData['mock_new_state'] = 'on';
      mockData['mock_old_state'] = 'off';
    }
    this.api.testAutomation(a.id, mockData).subscribe({
      next: (res) => {
        this.testResult.set({
          ruleId: a.id,
          conditionResult: res.condition_result,
          wouldFire: res.would_fire,
          cooldownActive: !!(res as Record<string, unknown>)['cooldown_active'],
          error: (res as Record<string, unknown>)['error'] as string | undefined,
        });
        this.testing.set(false);
      },
      error: (err) => {
        this.testResult.set({
          ruleId: a.id,
          conditionResult: false,
          wouldFire: false,
          cooldownActive: false,
          error: err?.error?.message ?? err?.message ?? 'Test failed',
        });
        this.testing.set(false);
      },
    });
  }

  addAutomation(): void {
    const eui = this.eui();
    if (!eui) return;
    this.saving.set(true);
    this.message.set(null);

    const actionConfig: Record<string, unknown> = { target_eui: this.form.target_eui };
    if (this.form.action_type === 'setControl') {
      actionConfig['control'] = this.form.control;
      actionConfig['state'] = this.form.state;
      if (this.form.duration > 0) actionConfig['duration'] = this.form.duration;
    } else {
      actionConfig['command'] = this.form.command;
      if (this.form.commandValue != null) actionConfig['value'] = this.form.commandValue;
    }

    const record: Partial<AutomationRecord> = {
      name: this.form.name,
      enabled: true,
      trigger_type: this.form.trigger_type,
      trigger_device: eui,
      condition_expr: this.form.condition_expr,
      action_type: this.form.action_type,
      action_config: actionConfig,
      cooldown_seconds: this.form.cooldown_seconds,
      priority: this.form.priority,
    };

    this.api.createAutomation(record).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Automation created.');
        this.saving.set(false);
        this.form.name = '';
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
    const eui = this.eui();
    if (!eui) return;
    this.api.getAutomations(eui).subscribe((list) => this.automations.set(list));
    this.api.getAutomationLog(undefined, 20).subscribe((logs) => this.logEntries.set(logs));
  }
}
