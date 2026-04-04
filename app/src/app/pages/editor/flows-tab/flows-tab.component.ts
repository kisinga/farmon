import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { getFlowSensors } from '../../../core/models/topology.model';

@Component({
  selector: 'app-flows-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology()) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Flow Sensors ({{ flows().length }})</h2>
          <div class="text-xs text-base-content/50">Flow sensors live on pipes. Add them via the topology view.</div>
        </div>

        @if (flows().length === 0) {
          <div class="text-base-content/60 text-center py-8">No flow sensors defined.</div>
        } @else {
          <table class="table table-sm bg-base-100 rounded-xl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Pin</th>
                <th>Cal (pulses/L)</th>
                <th>PCNT</th>
                <th>On Pipe</th>
              </tr>
            </thead>
            <tbody>
              @for (flow of flows(); track flow.id) {
                <tr>
                  <td>
                    <input class="input input-bordered input-xs w-36" [ngModel]="flow.name"
                      (ngModelChange)="updateField(flow.id, 'name', $event)" />
                  </td>
                  <td>
                    <span class="font-mono text-xs">{{ flow.id }}</span>
                  </td>
                  <td>
                    <input class="input input-bordered input-xs w-24 font-mono" [ngModel]="flow.pin"
                      (ngModelChange)="updateField(flow.id, 'pin', $event)" placeholder="GPIO46" />
                  </td>
                  <td>
                    <input
                      type="number"
                      class="input input-bordered input-xs w-24 font-mono text-right"
                      [ngModel]="flow.flow_cal"
                      (ngModelChange)="updateNumField(flow.id, $event)"
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
                    <span class="text-xs text-base-content/50">{{ flowPipeLabel(flow.id) }}</span>
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

  protected flows = computed(() => {
    const t = this.editor.topology();
    return t ? getFlowSensors(t) : [];
  });

  protected flowPipeLabel(flowId: string): string {
    const t = this.editor.topology();
    if (!t) return '';
    const pipe = t.pipes.find((p) => p.components.some((c) => c.id === flowId));
    return pipe ? `${pipe.from} \u2192 ${pipe.to}` : '';
  }

  updateField(flowId: string, field: 'name' | 'pin', value: string) {
    this.editor.updateTopology((t) => {
      for (const pipe of t.pipes) {
        const comp = pipe.components.find((c) => c.kind === 'flow_sensor' && c.id === flowId);
        if (comp && comp.kind === 'flow_sensor') {
          comp[field] = value;
          return;
        }
      }
    });
  }

  updateNumField(flowId: string, value: unknown) {
    this.editor.updateTopology((t) => {
      for (const pipe of t.pipes) {
        const comp = pipe.components.find((c) => c.kind === 'flow_sensor' && c.id === flowId);
        if (comp && comp.kind === 'flow_sensor') {
          comp.flow_cal = Number(value) || 0;
          return;
        }
      }
    });
  }
}
