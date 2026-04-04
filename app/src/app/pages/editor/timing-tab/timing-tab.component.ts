import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';

interface TimingField {
  key: string;
  label: string;
  description: string;
  unit: string;
  default: string | number;
  group: string;
}

const FIELDS: TimingField[] = [
  { key: 'valve_travel_time', label: 'Valve Travel Time', description: 'Time for motorized ball valves to fully open or close', unit: 'duration', default: '15s', group: 'Mechanical' },
  { key: 'max_runtime_seconds', label: 'Max Runtime', description: 'Hard ceiling — pump stops after this regardless of state', unit: 'seconds', default: 1800, group: 'Safety' },
  { key: 'flow_watchdog_seconds', label: 'Flow Watchdog Timeout', description: 'If no flow detected within this window, fault is raised', unit: 'seconds', default: 30, group: 'Safety' },
  { key: 'flow_confirm_seconds', label: 'Flow Confirmation Time', description: 'Sustained flow duration before marking flow as "confirmed"', unit: 'seconds', default: 15, group: 'Safety' },
  { key: 'refill_watchdog_seconds', label: 'Refill Watchdog Window', description: 'Dest tank must rise within this window or fault is raised', unit: 'seconds', default: 60, group: 'Safety' },
  { key: 'refill_min_rise_pct', label: 'Min Level Rise', description: 'Minimum percentage rise per watchdog window', unit: '%', default: 0.5, group: 'Safety' },
  { key: 'api_watchdog_seconds', label: 'API Watchdog Timeout', description: 'Fault if Home Assistant disconnected for this long', unit: 'seconds', default: 300, group: 'Safety' },
  { key: 'flow_cal', label: 'Flow Calibration', description: 'Pulse count per liter for flow sensors', unit: 'pulses/L', default: 450, group: 'Calibration' },
  { key: 'update_interval', label: 'Sensor Update Interval', description: 'How often ADC and diagnostic sensors are read', unit: 'duration', default: '5s', group: 'Calibration' },
];

@Component({
  selector: 'app-timing-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.manifest(); as m) {
      <div class="max-w-2xl space-y-6">
        <div>
          <h2 class="text-lg font-semibold">Timing & Safety Constants</h2>
          <p class="text-sm text-base-content/50 mt-1">
            Defaults are tuned for motorized ball valves and typical residential plumbing. Adjust only if your hardware differs.
          </p>
        </div>

        @for (group of groups; track group) {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body gap-3">
              <h3 class="font-semibold text-sm text-base-content/60 uppercase tracking-wider">{{ group }}</h3>
              <div class="divide-y divide-base-200">
                @for (field of fieldsByGroup(group); track field.key) {
                  <div class="flex items-center gap-4 py-3">
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm">{{ field.label }}</div>
                      <div class="text-xs text-base-content/40 mt-0.5">{{ field.description }}</div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        class="input input-bordered input-sm w-24 text-right font-mono"
                        [ngModel]="getTimingValue(m, field)"
                        (ngModelChange)="update(field.key, $event)"
                        [placeholder]="'' + field.default"
                      />
                      <span class="text-xs text-base-content/40 w-16">{{ field.unit }}</span>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class TimingTabComponent {
  protected editor = inject(SystemEditorService);

  protected groups = [...new Set(FIELDS.map((f) => f.group))];

  protected getTimingValue(m: { timing: Record<string, string | number> }, field: TimingField): string | number {
    return field.key in m.timing ? m.timing[field.key] : field.default;
  }

  protected fieldsByGroup(group: string): TimingField[] {
    return FIELDS.filter((f) => f.group === group);
  }

  update(key: string, value: string) {
    this.editor.updateManifest((m) => {
      const num = Number(value);
      m.timing[key] = isNaN(num) ? value : num;
    });
  }
}
