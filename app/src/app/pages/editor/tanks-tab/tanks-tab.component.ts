import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { getTanks } from '../../../core/models/topology.model';

@Component({
  selector: 'app-tanks-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology(); as t) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Tanks ({{ tanks().length }})</h2>
          <button class="btn btn-primary btn-sm" (click)="add()">+ Add Tank</button>
        </div>

        @if (tanks().length === 0) {
          <div class="text-base-content/60 text-center py-8">No tanks defined. Add one to get started.</div>
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
              @for (tank of tanks(); track tank.id; let i = $index) {
                <tr>
                  <td>
                    <input
                      class="input input-bordered input-xs w-32"
                      [ngModel]="tank.name"
                      (ngModelChange)="updateField(tank.id, 'name', $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-bordered input-xs w-24 font-mono"
                      [ngModel]="tank.id"
                      (ngModelChange)="updateField(tank.id, 'id', $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-bordered input-xs w-24 font-mono"
                      [ngModel]="tank.level_pin"
                      (ngModelChange)="updateField(tank.id, 'level_pin', $event)"
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
                    <button class="btn btn-ghost btn-xs text-error" (click)="remove(tank.id)">Delete</button>
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

  protected tanks = computed(() => {
    const t = this.editor.topology();
    return t ? getTanks(t) : [];
  });

  protected adcPinList = computed(() => Array.from(this.editor.adcPins()).join(', '));

  add() {
    this.editor.updateTopology((t) => {
      const n = getTanks(t).length + 1;
      t.nodes.push({
        kind: 'tank',
        id: `tank${n}`,
        name: `Tank ${n}`,
        level_pin: '',
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 100, y: 100 + (n - 1) * 150 },
      });
    });
  }

  remove(tankId: string) {
    this.editor.updateTopology((t) => {
      t.nodes = t.nodes.filter((n) => !(n.kind === 'tank' && n.id === tankId));
      // Remove pipes connected to this tank
      t.pipes = t.pipes.filter((p) => {
        const fromNode = p.from.split(':')[0];
        const toNode = p.to.split(':')[0];
        return fromNode !== tankId && toNode !== tankId;
      });
      // Remove route overrides referencing this tank
      for (const key of Object.keys(t.route_overrides)) {
        if (key.includes(tankId)) delete t.route_overrides[key];
      }
    });
  }

  updateField(tankId: string, field: 'name' | 'id' | 'level_pin', value: string) {
    this.editor.updateTopology((t) => {
      const tank = t.nodes.find((n) => n.kind === 'tank' && n.id === tankId);
      if (tank && tank.kind === 'tank') {
        tank[field] = value;
      }
    });
  }
}
