import { Component, inject, signal, effect, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { BuildService } from '../../../core/services/build.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import type { Automation, AutomationTrigger, RouteOverride } from '../../../core/models/topology.model';
import { routeLevelInfo, type RouteLevelInfo } from '../shared/route-level-info';
import {
  AutomationTriggerSchema,
  AutomationSchema,
  RouteOverrideSchema,
  buildGraph,
  activeGraph,
  deriveRoutes,
  findRouteAutomationSensor,
} from '@core';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';
import { SectionHeaderComponent } from '../shared/section-header.component';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

@Component({
  selector: 'app-automations-tab',
  standalone: true,
  imports: [FormsModule, ZodInputComponent, SectionHeaderComponent],
  template: `
    @if (editor.topology(); as t) {
      <div class="content-pane space-y-6">
        <app-section-header
          title="Schedules"
          subtitle="Rules that run on the controller itself: start a route at a set time, or when a tank crosses a level. They keep working with no internet, since the controller runs them on its own clock." />

        @if (t.automations.length === 0) {
          <div class="surface px-6 py-10 text-center">
            <p class="text-sm text-base-content/50">No schedules yet.</p>
            <p class="text-xs text-base-content/40 mt-1">Add one to run a route automatically by time or tank level.</p>
          </div>
        }

        @for (auto of t.automations; track auto.id; let i = $index) {
          <div class="card surface">
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
                  <app-zod-input
                    [schema]="automationSchema"
                    fieldKey="name"
                    size="sm"
                    placeholder="e.g. Daily Refill"
                    [value]="auto.name"
                    (valueChange)="updateField(i, 'name', $any($event))" />
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
                    <app-zod-input
                      [schema]="triggerTimeSchema"
                      fieldKey="at"
                      type="time"
                      size="sm"
                      [value]="auto.trigger.at"
                      (valueChange)="updateTrigger(i, 'at', $any($event))" />
                  </div>
                }
                @if (auto.trigger.type === 'level') {
                  <div class="form-control col-span-2">
                    <label class="label pb-1"><span class="label-text text-xs">Sensor (auto-derived)</span></label>
                    @if (autoSensors().get(auto.route); as info) {
                      <p class="text-sm">{{ info.tankName }} <span class="text-xs text-base-content/50">via {{ info.sensorName }}</span></p>
                      <p class="text-xs text-base-content/50 mt-1">Fires when the source tank rises above the Source Min Level set below.</p>
                    } @else {
                      <p class="text-xs text-warning">This route's source tank has no level sensor before its first valve. Pick a different route or change trigger to time-based.</p>
                    }
                  </div>
                  <div class="form-control">
                    <label class="label pb-1"><span class="label-text text-xs">Hold (min)</span></label>
                    <app-zod-input
                      [schema]="triggerLevelSchema"
                      fieldKey="for_minutes"
                      type="number"
                      size="sm"
                      placeholder="e.g. 1"
                      [min]="0"
                      [max]="60"
                      [value]="auto.trigger.for_minutes"
                      (valueChange)="updateTrigger(i, 'for_minutes', $event)" />
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

              <!-- Firmware safety thresholds (stored in route_overrides).
                   For level triggers, Source Min Level doubles as the trigger
                   threshold — fires when source rises above this value. -->
              @if (routeLevels().get(auto.route); as levels) {
                @if (levels.sourceHasLevel || levels.destHasLevel) {
                  <div class="grid grid-cols-2 gap-4">
                    @if (levels.sourceHasLevel) {
                      <div class="form-control">
                        <label class="label pb-1"><span class="label-text text-xs">Source Min Level (%)</span></label>
                        <app-zod-input
                          [schema]="routeOverrideSchema"
                          fieldKey="source_min_level"
                          type="number"
                          size="sm"
                          placeholder="e.g. 20"
                          [min]="0"
                          [max]="100"
                          [value]="getOverride(auto.route, 'source_min_level')"
                          (valueChange)="updateOverride(auto.route, 'source_min_level', $any($event))" />
                        @if (auto.trigger.type === 'level') {
                          <p class="text-xs text-base-content/50 mt-1 italic">Also the trigger threshold for this automation.</p>
                        }
                      </div>
                    }
                    @if (levels.destHasLevel) {
                      <div class="form-control">
                        <label class="label pb-1"><span class="label-text text-xs">Dest Max Level (%)</span></label>
                        <app-zod-input
                          [schema]="routeOverrideSchema"
                          fieldKey="dest_max_level"
                          type="number"
                          size="sm"
                          placeholder="e.g. 90"
                          [min]="0"
                          [max]="100"
                          [value]="getOverride(auto.route, 'dest_max_level')"
                          (valueChange)="updateOverride(auto.route, 'dest_max_level', $any($event))" />
                      </div>
                    }
                  </div>
                  <p class="text-xs text-base-content/40 italic">
                    Firmware enforces these thresholds — prevents pump start if source too low or dest too high.
                  </p>
                }
              }
            </div>
          </div>
        }

        <button class="btn btn-primary btn-sm gap-2" (click)="add()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          Add Schedule
        </button>
      </div>
    }
  `,
})
export class AutomationsTabComponent {
  protected editor = inject(SystemEditorService);
  private build = inject(BuildService);
  private workspace = inject(WorkspaceService);

  protected days = DAYS;
  protected derivedRoutes = signal<Array<{ key: string; name: string }>>([]);
  protected triggerTimeSchema = AutomationTriggerSchema.optionsMap.get('time')!;
  protected triggerLevelSchema = AutomationTriggerSchema.optionsMap.get('level')!;
  protected automationSchema = AutomationSchema;
  protected routeOverrideSchema = RouteOverrideSchema;

  /**
   * Per-route auto-derived trigger sensor info, keyed by route key.
   * Routes with no eligible tank/sensor produce no entry — UI shows a warning.
   */
  protected autoSensors = computed(() => {
    const t = this.editor.topology();
    const result = new Map<string, { tankName: string; sensorName: string }>();
    if (!t) return result;
    const graph = buildGraph(t.nodes, t.pipes);
    const active = activeGraph(graph);
    const nodeKindById = new Map<string, string>(t.nodes.map(n => [n.id, n.kind]));
    const nodeById = new Map(t.nodes.map(n => [n.id, n]));
    const nameById = new Map<string, string>(t.nodes.map(n => [n.id, (n as { name?: string }).name ?? n.id]));
    for (const route of deriveRoutes(active)) {
      const found = findRouteAutomationSensor(route, nodeById);
      if (found) {
        result.set(route.key, {
          tankName: nameById.get(found.tankId) ?? found.tankId,
          sensorName: nameById.get(found.sensorId) ?? found.sensorId,
        });
      }
    }
    return result;
  });

  /** Precomputed level-sensor info for each route referenced by automations. */
  protected routeLevels = computed(() => {
    const t = this.editor.topology();
    if (!t) return new Map<string, RouteLevelInfo>();
    const result = new Map<string, RouteLevelInfo>();
    for (const auto of t.automations ?? []) {
      if (auto.route && !result.has(auto.route)) {
        result.set(auto.route, routeLevelInfo(auto.route, t.nodes, t.pipes));
      }
    }
    return result;
  });

  constructor() {
    effect(() => {
      const t = this.workspace.siteTopology();
      if (t) {
        this.build.deriveRoutes(t).then(routes => {
          this.derivedRoutes.set(routes);
        });
      }
    });
  }

  protected add() {
    const id = `auto_${Date.now().toString(36)}`;
    const firstRoute = this.derivedRoutes()[0]?.key ?? '';
    this.editor.updateTopology(t => {
      if (!t.automations) t.automations = [];
      t.automations.push({
        id,
        name: '',
        route: firstRoute,
        trigger: { type: 'time', at: '06:00' },
        days_of_week: [...DAYS],
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
      (t.automations[index] as Record<typeof field, unknown>)[field] = value;
    });
  }

  protected updateTriggerType(index: number, type: 'time' | 'level') {
    this.editor.updateTopology(t => {
      if (type === 'time') {
        t.automations[index].trigger = { type: 'time', at: '06:00' };
      } else {
        t.automations[index].trigger = { type: 'level' };
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

  protected getOverride(routeKey: string, field: keyof RouteOverride): number | undefined {
    const t = this.editor.topology();
    return t?.route_overrides?.[routeKey]?.[field];
  }

  protected updateOverride(routeKey: string, field: keyof RouteOverride, value: number | undefined) {
    this.editor.updateTopology(t => {
      if (!t.route_overrides) t.route_overrides = {};
      if (!t.route_overrides[routeKey]) t.route_overrides[routeKey] = {};
      t.route_overrides[routeKey][field] = value;
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

}
