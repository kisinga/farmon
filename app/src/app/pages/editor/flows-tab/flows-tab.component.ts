import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';

@Component({
  selector: 'app-flows-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.manifest(); as m) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Flow Sensors ({{ m.flow_sensors.length }})</h2>
          <button class="btn btn-primary btn-sm" (click)="add()">+ Add Flow Sensor</button>
        </div>

        @if (m.flow_sensors.length === 0) {
          <div class="text-base-content/40 text-center py-8">No flow sensors defined.</div>
        } @else {
          <table class="table table-sm bg-base-100 rounded-xl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Pin</th>
                <th>Cal (pulses/L)</th>
                <th>PCNT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (flow of m.flow_sensors; track flow.id; let i = $index) {
                <tr>
                  <td>
                    <input class="input input-bordered input-xs w-36" [ngModel]="flow.name"
                      (ngModelChange)="updateField(i, 'name', $event)" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="flow.id"
                      (ngModelChange)="updateField(i, 'id', $event)" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="flow.pin"
                      (ngModelChange)="updateField(i, 'pin', $event)" placeholder="GPIO46" />
                  </td>
                  <td>
                    <input
                      type="number"
                      class="input input-bordered input-xs w-24 font-mono text-right"
                      [ngModel]="flow.flow_cal"
                      (ngModelChange)="updateNumField(i, 'flow_cal', $event)"
                      placeholder="450"
                      min="1"
                    />
                  </td>
                  <td>
                    @if (editor.pcntPins().has(flow.pin)) {
                      <span class="badge badge-success badge-xs">OK</span>
                    } @else if (flow.pin) {
                      <span class="badge badge-warning badge-xs" title="Software counting — may miss pulses">SW</span>
                    }
                  </td>
                  <td>
                    <button class="btn btn-ghost btn-xs text-error" (click)="remove(i)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>

          <div class="text-xs text-base-content/50 space-y-1">
            <div>Pulse counter pins: {{ pcntPinList() }}</div>
            <div>Common calibration values: YF-S201 = 450, YF-B1 = 660, YF-S402B = 4380</div>
          </div>
        }
      </div>
    }
  `,
})
export class FlowsTabComponent {
  protected editor = inject(SystemEditorService);
  protected pcntPinList = computed(() => Array.from(this.editor.pcntPins()).join(', '));

  add() {
    this.editor.updateManifest((m) => {
      const n = m.flow_sensors.length + 1;
      m.flow_sensors.push({ name: `Flow ${n}`, id: `flow${n}`, pin: '', flow_cal: 450 });
    });
  }

  remove(index: number) {
    this.editor.updateManifest((m) => { m.flow_sensors.splice(index, 1); });
  }

  updateField(index: number, field: string, value: string) {
    this.editor.updateManifest((m) => {
      (m.flow_sensors[index] as Record<string, unknown>)[field] = value;
    });
  }

  updateNumField(index: number, field: string, value: unknown) {
    this.editor.updateManifest((m) => {
      (m.flow_sensors[index] as Record<string, unknown>)[field] = Number(value) || 0;
    });
  }
}
