import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';

@Component({
  selector: 'app-valves-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.manifest(); as m) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Valves ({{ m.valves.length }})</h2>
          <button class="btn btn-primary btn-sm" (click)="add()">+ Add Valve</button>
        </div>

        @if (m.valves.length === 0) {
          <div class="text-base-content/40 text-center py-8">No valves defined.</div>
        } @else {
          <table class="table table-sm bg-base-100 rounded-xl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Open Pin</th>
                <th>Close Pin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (valve of m.valves; track valve.id; let i = $index) {
                <tr>
                  <td>
                    <input class="input input-bordered input-xs w-36" [ngModel]="valve.name"
                      (ngModelChange)="updateField(i, 'name', $event)" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="valve.id"
                      (ngModelChange)="updateField(i, 'id', $event)" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="valve.open_pin"
                      (ngModelChange)="updateField(i, 'open_pin', $event)" placeholder="GPIO4" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="valve.close_pin"
                      (ngModelChange)="updateField(i, 'close_pin', $event)" placeholder="GPIO5" />
                  </td>
                  <td>
                    <button class="btn btn-ghost btn-xs text-error" (click)="remove(i)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
})
export class ValvesTabComponent {
  protected editor = inject(SystemEditorService);

  add() {
    this.editor.updateManifest((m) => {
      const n = m.valves.length + 1;
      m.valves.push({ name: `Valve ${n}`, id: `valve${n}`, open_pin: '', close_pin: '' });
    });
  }

  remove(index: number) {
    this.editor.updateManifest((m) => { m.valves.splice(index, 1); });
  }

  updateField(index: number, field: string, value: string) {
    this.editor.updateManifest((m) => {
      (m.valves[index] as Record<string, string>)[field] = value;
    });
  }
}
