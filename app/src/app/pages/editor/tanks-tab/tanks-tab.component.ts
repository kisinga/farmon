import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';

@Component({
  selector: 'app-tanks-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.manifest(); as m) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Tanks ({{ m.tanks.length }})</h2>
          <button class="btn btn-primary btn-sm" (click)="add()">+ Add Tank</button>
        </div>

        @if (m.tanks.length === 0) {
          <div class="text-base-content/40 text-center py-8">No tanks defined. Add one to get started.</div>
        } @else {
          <table class="table table-sm bg-base-100 rounded-xl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Level Pin</th>
                <th>ADC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (tank of m.tanks; track tank.id; let i = $index) {
                <tr>
                  <td>
                    <input
                      class="input input-bordered input-xs w-32"
                      [ngModel]="tank.name"
                      (ngModelChange)="updateField(i, 'name', $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-bordered input-xs w-24 font-mono"
                      [ngModel]="tank.id"
                      (ngModelChange)="updateField(i, 'id', $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-bordered input-xs w-24 font-mono"
                      [ngModel]="tank.level_pin"
                      (ngModelChange)="updateField(i, 'level_pin', $event)"
                      placeholder="GPIO19"
                    />
                  </td>
                  <td>
                    @if (editor.adcPins().has(tank.level_pin)) {
                      <span class="badge badge-success badge-xs">OK</span>
                    } @else {
                      <span class="badge badge-error badge-xs">No ADC</span>
                    }
                  </td>
                  <td>
                    <button class="btn btn-ghost btn-xs text-error" (click)="remove(i)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>

          <div class="text-xs text-base-content/50">
            ADC-capable pins: {{ adcPinList() }}
          </div>
        }
      </div>
    }
  `,
})
export class TanksTabComponent {
  protected editor = inject(SystemEditorService);
  protected adcPinList = computed(() => Array.from(this.editor.adcPins()).join(', '));

  add() {
    this.editor.updateManifest((m) => {
      const n = m.tanks.length + 1;
      m.tanks.push({ name: `Tank ${n}`, id: `tank${n}`, level_pin: '' });
    });
  }

  remove(index: number) {
    this.editor.updateManifest((m) => {
      m.tanks.splice(index, 1);
    });
  }

  updateField(index: number, field: 'name' | 'id' | 'level_pin', value: string) {
    this.editor.updateManifest((m) => {
      (m.tanks[index] as Record<string, string>)[field] = value;
    });
  }
}
