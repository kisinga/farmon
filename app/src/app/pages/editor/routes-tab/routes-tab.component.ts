import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';

@Component({
  selector: 'app-routes-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.manifest(); as m) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Routes ({{ m.routes.length }})</h2>
          <button class="btn btn-primary btn-sm" (click)="add()">+ Add Route</button>
        </div>

        @if (m.flow_sensors.length === 0) {
          <div class="alert alert-warning">
            <span>Every route requires a flow sensor. Add at least one in the Flows tab.</span>
          </div>
        }

        @if (m.routes.length === 0) {
          <div class="text-base-content/40 text-center py-8">No routes defined.</div>
        } @else {
          @for (route of m.routes; track route.name; let i = $index) {
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body p-4 gap-3">
                <div class="flex items-center justify-between">
                  <input
                    class="input input-bordered input-sm w-36 font-mono"
                    [ngModel]="route.name"
                    (ngModelChange)="updateField(i, 'name', $event)"
                    placeholder="T1>H2"
                  />
                  <button class="btn btn-ghost btn-xs text-error" (click)="remove(i)">Delete</button>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <!-- Source -->
                  <div class="form-control">
                    <label class="label py-0"><span class="label-text text-xs">Source Tank</span></label>
                    <select class="select select-bordered select-xs" [ngModel]="route.source"
                      (ngModelChange)="updateField(i, 'source', $event)">
                      <option value="">Select...</option>
                      @for (t of m.tanks; track t.id) {
                        <option [value]="t.id">{{ t.name }} ({{ t.id }})</option>
                      }
                    </select>
                  </div>

                  <!-- Destination -->
                  <div class="form-control">
                    <label class="label py-0"><span class="label-text text-xs">Destination Tank (optional)</span></label>
                    <select class="select select-bordered select-xs" [ngModel]="route.destination ?? ''"
                      (ngModelChange)="updateField(i, 'destination', $event || undefined)">
                      <option value="">Endpoint (house, irrigation)</option>
                      @for (t of m.tanks; track t.id) {
                        <option [value]="t.id">{{ t.name }} ({{ t.id }})</option>
                      }
                    </select>
                  </div>
                </div>

                @if (route.destination) {
                  <div class="text-xs text-info flex items-center gap-1">
                    <span class="i-mdi-information-outline"></span>
                    Float switch required on destination tank for overflow protection.
                  </div>
                }

                <!-- Valves -->
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs">Valves (select all that open for this route)</span></label>
                  <div class="flex flex-wrap gap-2 mt-1">
                    @for (v of m.valves; track v.id) {
                      <label class="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-xs checkbox-primary"
                          [checked]="route.valves.includes(v.id)"
                          (change)="toggleValve(i, v.id, $event)"
                        />
                        <span class="text-xs">{{ v.name }}</span>
                      </label>
                    }
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <!-- Flow sensor (required) -->
                  <div class="form-control">
                    <label class="label py-0"><span class="label-text text-xs">Flow Sensor (required)</span></label>
                    <select class="select select-bordered select-xs" [ngModel]="route.flow_sensor"
                      (ngModelChange)="updateField(i, 'flow_sensor', $event)">
                      @for (f of m.flow_sensors; track f.id) {
                        <option [value]="f.id">{{ f.name }}</option>
                      }
                    </select>
                  </div>

                  <!-- Max runtime -->
                  <div class="form-control">
                    <label class="label py-0"><span class="label-text text-xs">Max Runtime (seconds)</span></label>
                    <input
                      type="number"
                      class="input input-bordered input-xs w-24 font-mono"
                      [ngModel]="route.max_runtime_seconds"
                      (ngModelChange)="updateField(i, 'max_runtime_seconds', +$event)"
                      placeholder="1800"
                      min="10"
                    />
                  </div>
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
  `,
})
export class RoutesTabComponent {
  protected editor = inject(SystemEditorService);

  add() {
    this.editor.updateManifest((m) => {
      m.routes.push({
        name: '',
        source: m.tanks[0]?.id ?? '',
        valves: [],
        flow_sensor: m.flow_sensors[0]?.id ?? '',
        max_runtime_seconds: 1800,
      });
    });
  }

  remove(index: number) {
    this.editor.updateManifest((m) => { m.routes.splice(index, 1); });
  }

  updateField(index: number, field: string, value: unknown) {
    this.editor.updateManifest((m) => {
      (m.routes[index] as Record<string, unknown>)[field] = value;
    });
  }

  toggleValve(routeIndex: number, valveId: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.editor.updateManifest((m) => {
      const route = m.routes[routeIndex];
      if (checked) {
        if (!route.valves.includes(valveId)) route.valves.push(valveId);
      } else {
        route.valves = route.valves.filter((v) => v !== valveId);
      }
    });
  }
}
