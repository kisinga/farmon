import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, WorkflowLogRecord, WorkflowRecord } from '../../core/services/api.service';
import { DeviceManagerService } from '../../core/services/device-manager.service';

@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <header class="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="page-title">Workflows</h1>
        <p class="page-description">Automation pipelines that react to device events and trigger actions.</p>
      </div>
      <a routerLink="/workflows/new" class="btn btn-primary gap-2 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New workflow
      </a>
    </header>

    @if (message()) {
      <div class="alert text-sm rounded-xl mb-4" [class.alert-error]="isError()" [class.alert-success]="!isError()">
        <span>{{ message() }}</span>
      </div>
    }

    <!-- Workflow list -->
    @if (workflows().length === 0 && !loading()) {
      <div class="card-elevated">
        <div class="card-body-spaced flex flex-col items-center justify-center py-12 text-center">
          <div class="rounded-full bg-base-200 p-6 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 class="text-lg font-semibold text-base-content mb-1">No workflows yet</h2>
          <p class="text-base-content/60 text-sm max-w-md mb-4">
            Workflows automate actions when device events occur. Create your first one to get started.
          </p>
          <a routerLink="/workflows/new" class="btn btn-primary">Create your first workflow</a>
        </div>
      </div>
    } @else {
      <div class="space-y-3 mb-6">
        @for (w of workflows(); track w.id) {
          <div class="card-elevated">
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
                <a [routerLink]="['/workflows', w.id, 'edit']" class="btn btn-ghost btn-xs">Edit</a>
                <button class="btn btn-ghost btn-xs" (click)="testWorkflow(w)" [disabled]="testing()">Test</button>
                <button class="btn btn-ghost btn-xs text-error" (click)="deleteWorkflow(w)">Delete</button>
              </div>
            </div>

            <!-- Pipeline visualization -->
            <div class="border-t border-base-300 bg-base-200/30 px-5 py-2.5">
              <div class="flex items-center gap-2 flex-wrap text-xs">
                @for (t of w.triggers; track $index) {
                  <span class="badge badge-sm badge-outline badge-info gap-1">
                    {{ triggerLabel(t.type) }}
                    @if (t.filter?.device_eui) {
                      <a [routerLink]="['/device', t.filter!.device_eui!]" class="font-mono link link-hover">{{ deviceName(t.filter!.device_eui!) }}</a>
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
                      <a [routerLink]="['/device', a.target_eui]" class="font-mono link link-hover opacity-70">{{ deviceName(a.target_eui) }}</a>
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
              <div class="border-t border-base-300 bg-base-200/20 px-5 py-2">
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
      <div class="card-elevated">
        <details class="group">
          <summary class="flex items-center justify-between cursor-pointer px-5 py-3.5 text-sm font-semibold select-none">
            <span>Recent activity ({{ logEntries().length }})</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div class="border-t border-base-300 px-3 pb-3">
            <div class="overflow-x-auto">
              <table class="table table-xs">
                <thead>
                  <tr class="text-base-content/50">
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
                          <a [routerLink]="['/device', l.trigger_device]" class="link link-hover">{{ deviceName(l.trigger_device) }}</a>
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
      </div>
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private api = inject(ApiService);
  private deviceManager = inject(DeviceManagerService);

  workflows = signal<WorkflowRecord[]>([]);
  logEntries = signal<WorkflowLogRecord[]>([]);
  loading = signal(false);
  testing = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);
  testResult = signal<{ workflowId: string; conditionResult: boolean; wouldFire: boolean; cooldownActive: boolean; error?: string } | null>(null);

  ngOnInit(): void {
    this.refreshList();
  }

  deviceName(eui: string): string {
    const dev = this.deviceManager.getDevice(eui);
    return dev?.device_name || eui.slice(0, 8);
  }

  triggerLabel(type: string): string {
    switch (type) {
      case 'telemetry': return 'Sensor';
      case 'state_change': return 'State change';
      case 'checkin': return 'Checkin';
      case 'schedule': return 'Schedule';
      default: return type;
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
