import { Component, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ElectronService } from '../../../core/services/electron.service';
import type { Automation, AutomationTrigger } from '../../../core/models/topology.model';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

@Component({
  selector: 'app-automations-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology(); as t) {
      <div class="max-w-2xl space-y-6">
        <div>
          <h2 class="text-lg font-semibold">Timed Automations</h2>
          <p class="text-sm text-base-content/50 mt-1">
            Define HA automations that will be generated alongside your dashboard.
            These run in Home Assistant, not on the device — you can edit them in HA after deployment.
          </p>
        </div>

        @for (auto of t.automations; track auto.id; let i = $index) {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body gap-4">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold text-sm">{{ auto.name || 'Untitled' }}</h3>
                <div class="flex items-center gap-2">
                  <label class="label cursor-pointer gap-2">
                    <span class="text-xs text-base-content/60">Enabled</span>
                    <input
                      type="checkbox"
                      class="toggle toggle-sm toggle-primary"
                      [ngModel]="auto.enabled"
                      (ngModelChange)="updateField(i, 'enabled', $event)"
                    />
                  </label>
                  <button class="btn btn-ghost btn-xs btn-square text-error" (click)="remove(i)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <!-- Name -->
                <div class="form-control">
                  <label class="label pb-1"><span class="label-text text-xs">Name</span></label>
                  <input
                    type="text"
                    class="input input-bordered input-sm"
                    [ngModel]="auto.name"
                    (ngModelChange)="updateField(i, 'name', $event)"
                    placeholder="e.g. Daily Refill"
                  />
                </div>

                <!-- Route -->
                <div class="form-control">
                  <label class="label pb-1"><span class="label-text text-xs">Route</span></label>
                  <select
                    class="select select-bordered select-sm"
                    [ngModel]="auto.route"
                    (ngModelChange)="updateField(i, 'route', $event)"
                  >
                    <option value="" disabled>Select route...</option>
                    @for (route of derivedRoutes(); track route.key) {
                      <option [value]="route.key">{{ route.name }}</option>
                    }
                  </select>
                </div>
              </div>

              <!-- Trigger -->
              <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                  <label class="label pb-1"><span class="label-text text-xs">Trigger</span></label>
                  <select
                    class="select select-bordered select-sm"
                    [ngModel]="auto.trigger.type"
                    (ngModelChange)="updateTriggerType(i, $event)"
                  >
                    <option value="time">Time</option>
                    <option value="level">Level</option>
                  </select>
                </div>
                @if (auto.trigger.type === 'time') {
                  <div class="form-control">
                    <label class="label pb-1"><span class="label-text text-xs">Time (HH:MM)</span></label>
                    <input
                      type="time"
                      class="input input-bordered input-sm"
                      [ngModel]="auto.trigger.at ?? '06:00'"
                      (ngModelChange)="updateTrigger(i, 'at', $event)"
                    />
                  </div>
                }
                @if (auto.trigger.type === 'level') {
                  <div class="form-control">
                    <label class="label pb-1"><span class="label-text text-xs">Entity</span></label>
                    <input
                      type="text"
                      class="input input-bordered input-sm"
                      [ngModel]="auto.trigger.entity ?? ''"
                      (ngModelChange)="updateTrigger(i, 'entity', $event)"
                      placeholder="sensor.xxx_level"
                    />
                  </div>
                }
              </div>

              <!-- Days of week -->
              <div class="form-control">
                <label class="label pb-1"><span class="label-text text-xs">Days</span></label>
                <div class="flex gap-1">
                  @for (day of days; track day) {
                    <button
                      class="btn btn-xs"
                      [class.btn-primary]="(auto.days_of_week).includes(day)"
                      [class.btn-ghost]="!(auto.days_of_week).includes(day)"
                      (click)="toggleDay(i, day)"
                    >{{ day.slice(0, 2) }}</button>
                  }
                </div>
              </div>

              <!-- Conditions -->
              <div class="collapse collapse-arrow bg-base-200/50">
                <input type="checkbox" class="peer" />
                <div class="collapse-title text-xs font-medium text-base-content/60 min-h-0 py-2">
                  Conditions
                </div>
                <div class="collapse-content">
                  <div class="grid grid-cols-2 gap-4 pt-2">
                    <div class="form-control">
                      <label class="label pb-1"><span class="label-text text-xs">Source min level (%)</span></label>
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        [ngModel]="auto.conditions.source_min_level ?? ''"
                        (ngModelChange)="updateCondition(i, 'source_min_level', $event)"
                        min="0"
                        max="100"
                        placeholder="e.g. 20"
                      />
                    </div>
                    <div class="form-control">
                      <label class="label pb-1"><span class="label-text text-xs">Dest max level (%)</span></label>
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        [ngModel]="auto.conditions.dest_max_level ?? ''"
                        (ngModelChange)="updateCondition(i, 'dest_max_level', $event)"
                        min="0"
                        max="100"
                        placeholder="e.g. 90"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }

        <button class="btn btn-outline btn-sm gap-2" (click)="add()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          Add Automation
        </button>
      </div>
    }
  `,
})
export class AutomationsTabComponent {
  protected editor = inject(SystemEditorService);
  private electron = inject(ElectronService);

  protected days = DAYS;
  protected derivedRoutes = signal<Array<{ key: string; name: string }>>([]);

  constructor() {
    effect(() => {
      const t = this.editor.topology();
      if (t) {
        this.electron.deriveRoutes(t).then(routes => {
          this.derivedRoutes.set(routes);
        });
      }
    });
  }

  protected add() {
    const id = `auto_${Date.now().toString(36)}`;
    this.editor.updateTopology(t => {
      if (!t.automations) t.automations = [];
      t.automations.push({
        id,
        name: '',
        route: '',
        trigger: { type: 'time', at: '06:00' },
        days_of_week: [...DAYS],
        conditions: {},
        enabled: true,
      });
    });
  }

  protected remove(index: number) {
    this.editor.updateTopology(t => {
      t.automations.splice(index, 1);
    });
  }

  protected updateField(index: number, field: keyof Automation, value: unknown) {
    this.editor.updateTopology(t => {
      (t.automations[index] as any)[field] = value;
    });
  }

  protected updateTriggerType(index: number, type: 'time' | 'level') {
    this.editor.updateTopology(t => {
      if (type === 'time') {
        t.automations[index].trigger = { type: 'time', at: '06:00' };
      } else {
        t.automations[index].trigger = { type: 'level', entity: '' };
      }
    });
  }

  protected updateTrigger(index: number, field: string, value: unknown) {
    this.editor.updateTopology(t => {
      const trigger = t.automations[index].trigger;
      // Rebuild trigger to stay type-safe
      t.automations[index].trigger = { ...trigger, [field]: value } as typeof trigger;
    });
  }

  protected toggleDay(index: number, day: typeof DAYS[number]) {
    this.editor.updateTopology(t => {
      const auto = t.automations[index];
      if (!auto.days_of_week) auto.days_of_week = [...DAYS];
      const idx = auto.days_of_week.indexOf(day);
      if (idx >= 0) {
        if (auto.days_of_week.length > 1) auto.days_of_week.splice(idx, 1);
      } else {
        auto.days_of_week.push(day);
      }
    });
  }

  protected updateCondition(index: number, field: 'source_min_level' | 'dest_max_level', value: string) {
    this.editor.updateTopology(t => {
      if (!t.automations[index].conditions) t.automations[index].conditions = {};
      const num = Number(value);
      if (value === '' || isNaN(num)) {
        delete (t.automations[index].conditions as Record<string, unknown>)[field];
      } else {
        (t.automations[index].conditions as Record<string, unknown>)[field] = num;
      }
    });
  }
}
