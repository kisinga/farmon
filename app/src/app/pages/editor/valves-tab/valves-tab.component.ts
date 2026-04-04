import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { getValves, type ValveComponent } from '../../../core/models/topology.model';

@Component({
  selector: 'app-valves-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology()) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Valves ({{ valves().length }})</h2>
          <div class="text-xs text-base-content/50">Valves live on pipes. Add them via the topology view.</div>
        </div>

        @if (valves().length === 0) {
          <div class="text-base-content/60 text-center py-8">No valves defined.</div>
        } @else {
          <table class="table table-sm bg-base-100 rounded-xl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Open Pin</th>
                <th>Close Pin</th>
                <th>On Pipe</th>
              </tr>
            </thead>
            <tbody>
              @for (valve of valves(); track valve.id) {
                <tr>
                  <td>
                    <input class="input input-bordered input-xs w-36" [ngModel]="valve.name"
                      (ngModelChange)="updateField(valve.id, 'name', $event)" />
                  </td>
                  <td>
                    <span class="font-mono text-xs">{{ valve.id }}</span>
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="valve.open_pin"
                      (ngModelChange)="updateField(valve.id, 'open_pin', $event)" placeholder="GPIO4" />
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="valve.close_pin"
                      (ngModelChange)="updateField(valve.id, 'close_pin', $event)" placeholder="GPIO5" />
                  </td>
                  <td>
                    <span class="text-xs text-base-content/50">{{ valvePipeLabel(valve.id) }}</span>
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

  protected valves = computed(() => {
    const t = this.editor.topology();
    return t ? getValves(t) : [];
  });

  protected valvePipeLabel(valveId: string): string {
    const t = this.editor.topology();
    if (!t) return '';
    const pipe = t.pipes.find((p) => p.components.some((c) => c.id === valveId));
    return pipe ? `${pipe.from} \u2192 ${pipe.to}` : '';
  }

  updateField(valveId: string, field: keyof ValveComponent, value: string) {
    this.editor.updateTopology((t) => {
      for (const pipe of t.pipes) {
        const comp = pipe.components.find((c) => c.kind === 'valve' && c.id === valveId);
        if (comp && comp.kind === 'valve') {
          (comp as Record<string, unknown>)[field] = value;
          return;
        }
      }
    });
  }
}
