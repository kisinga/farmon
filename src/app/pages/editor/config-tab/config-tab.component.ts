import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { BoardService } from '../../../core/services/board.service';
import { peripheralIconPath, peripheralLabel, peripheralDescription } from '../../../core/models/peripheral-icons';
import { BoardSvgComponent } from '../../../shared/board-svg/board-svg.component';
import { slug, NODE_REGISTRY, TimingSchema, DeviceSchema, IoProviderDefSchema, COMPONENT_ID_POLICY } from '@far-mon/core';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';

interface TimingField {
  key: string;
  label: string;
  description: string;
  unit: string;
  default: number;
  group: string;
}

const TIMING_FIELDS: TimingField[] = [
  { key: 'valve_travel_time', label: 'Valve Travel Time', description: 'Time for motorized ball valves to fully open or close', unit: 'seconds', default: 15, group: 'Mechanical' },
  { key: 'flow_watchdog', label: 'Flow Watchdog Timeout', description: 'If no flow detected within this window, fault is raised', unit: 'seconds', default: 30, group: 'Safety' },
  { key: 'flow_confirm', label: 'Flow Confirmation Time', description: 'Sustained flow duration before marking flow as "confirmed"', unit: 'seconds', default: 15, group: 'Safety' },
  { key: 'api_watchdog', label: 'API Watchdog Timeout', description: 'Fault if Home Assistant disconnected for this long', unit: 'seconds', default: 300, group: 'Safety' },
  { key: 'update_interval', label: 'Sensor Update Interval', description: 'How often ADC and diagnostic sensors are read', unit: 'seconds', default: 5, group: 'Calibration' },
];

@Component({
  selector: 'app-config-tab',
  standalone: true,
  imports: [FormsModule, BoardSvgComponent, ZodInputComponent],
  template: `
    @if (editor.topology(); as t) {
      <div class="content-pane space-y-6">
        <!-- Device identity -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Device Identity</h2>
            <label class="form-control">
              <div class="label"><span class="label-text font-medium">Friendly Name</span></div>
              <app-zod-input
                [schema]="deviceSchema"
                fieldKey="friendly_name"
                size="sm"
                [value]="t.device.friendly_name"
                (valueChange)="updateFriendlyName($any($event))" />
              <div class="label"><span class="label-text-alt text-base-content/60 font-mono">ESPHome ID: {{ t.device.name }}</span></div>
            </label>
          </div>
        </div>

        <!-- Board selection -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Target Board</h2>
            <label class="form-control">
              <div class="label"><span class="label-text font-medium">Board</span></div>
              <select
                class="select select-bordered select-sm"
                [ngModel]="t.device.board"
                (ngModelChange)="changeBoard($event)"
              >
                @for (b of boards.boards(); track b.id) {
                  <option [value]="b.id">{{ b.label }}</option>
                }
              </select>
            </label>

            @if (editor.board(); as board) {
              <div class="grid grid-cols-2 gap-3 mt-2">
                @for (p of peripherals(); track p.key) {
                  <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200/50">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-success/20">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="p.iconPath" />
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium">{{ p.label }}</div>
                      <div class="text-xs text-base-content/60">{{ p.description }}</div>
                    </div>
                  </div>
                }
              </div>

              <div class="stats stats-horizontal bg-base-200/50 w-full mt-2">
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Exposed Pins</div>
                  <div class="stat-value text-lg">{{ board.pins.length }}</div>
                </div>
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Reserved</div>
                  <div class="stat-value text-lg">{{ editor.reservedPins().size }}</div>
                </div>
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Available</div>
                  <div class="stat-value text-lg">{{ board.pins.length - editor.reservedPins().size }}</div>
                </div>
              </div>

              @if (editor.usedPins().size > 0) {
                <button
                  class="btn btn-outline btn-warning btn-sm mt-2 w-full"
                  (click)="clearAllPins()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear All Pin Assignments ({{ editor.usedPins().size }})
                </button>
              }

              <!-- Board pinout diagram -->
              @if (boards.activeSvg()) {
                <div class="mt-3">
                  <app-board-svg
                    [board]="editor.board()"
                    [svgContent]="boards.activeSvg()"
                    [usedPins]="editor.usedPins()"
                  />
                </div>
              }
            }
          </div>
        </div>

        <!-- I/O Providers -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-base">I/O Providers</h2>
              <button class="btn btn-sm btn-primary" (click)="addProvider()">+ Add</button>
            </div>
            @for (prov of t.device.io_providers ?? []; track prov.id) {
              <div class="border border-base-200 rounded-lg p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <app-zod-input
                      [schema]="providerSchema"
                      fieldKey="id"
                      inputClass="font-mono w-28"
                      [policy]="componentIdPolicy"
                      [value]="prov.id"
                      (valueChange)="updateProviderId(prov.id, $any($event))" />
                    <select class="select select-xs select-bordered"
                      [ngModel]="prov.type"
                      (ngModelChange)="updateProviderType(prov.id, $event)">
                      <option value="modbus_controller">Modbus Controller</option>
                    </select>
                  </div>
                  <button class="btn btn-ghost btn-xs text-error" (click)="removeProvider(prov.id)">Remove</button>
                </div>
                @if (prov.type === 'modbus_controller') {
                  <div class="grid grid-cols-2 gap-2">
                    <label class="form-control">
                      <span class="label-text text-xs">UART Bus</span>
                      <select class="select select-xs select-bordered font-mono"
                        [ngModel]="$any(prov.config)['bus']"
                        (ngModelChange)="updateProviderConfig(prov.id, 'bus', $event)">
                        <option value="">--</option>
                        @for (bus of t.device.uart_buses ?? []; track bus.id) {
                          <option [value]="bus.id">{{ bus.id }}</option>
                        }
                      </select>
                    </label>
                    <label class="form-control">
                      <span class="label-text text-xs">Address</span>
                      <input type="number" class="input input-xs input-bordered font-mono"
                        [ngModel]="$any(prov.config)['address']"
                        (ngModelChange)="updateProviderConfig(prov.id, 'address', +$event)"
                        min="1" max="247" />
                    </label>
                  </div>
                }
              </div>
            }
            @if (!(t.device.io_providers ?? []).length) {
              <p class="text-sm text-base-content/50">No I/O providers configured.</p>
            }
          </div>
        </div>

        <!-- Timing & Safety Constants -->
        <div>
          <h2 class="text-lg font-semibold">Timing & Safety Constants</h2>
          <p class="text-sm text-base-content/50 mt-1">
            Defaults are tuned for motorized ball valves and typical residential plumbing. Adjust only if your hardware differs.
          </p>
        </div>

        @for (group of timingGroups; track group) {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body gap-3">
              <h3 class="font-semibold text-sm text-base-content/60 uppercase tracking-wider">{{ group }}</h3>
              <div class="divide-y divide-base-200">
                @for (field of fieldsByGroup(group); track field.key) {
                  <div class="flex items-center gap-4 py-3">
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm">{{ field.label }}</div>
                      <div class="text-xs text-base-content/60 mt-0.5">{{ field.description }}</div>
                    </div>
                    <div class="flex flex-col items-end gap-1 shrink-0">
                      <div class="flex items-center gap-2">
                        <app-zod-input
                          [schema]="timingSchema"
                          [fieldKey]="field.key"
                          type="number"
                          size="sm"
                          inputClass="w-24 text-right font-mono"
                          [placeholder]="'' + field.default"
                          [min]="2"
                          [value]="getTimingValue(t, field)"
                          (valueChange)="updateTiming(field.key, $any($event))" />
                        <span class="text-xs text-base-content/60 w-16">{{ field.unit }}</span>
                      </div>
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
export class ConfigTabComponent {
  protected editor = inject(SystemEditorService);
  protected boards = inject(BoardService);

  protected timingGroups = [...new Set(TIMING_FIELDS.map((f) => f.group))];
  protected timingSchema = TimingSchema;
  protected deviceSchema = DeviceSchema;
  protected providerSchema = IoProviderDefSchema;
  protected componentIdPolicy = COMPONENT_ID_POLICY;

  protected peripherals = computed(() => {
    const board = this.editor.board();
    if (!board) return [];
    return Object.entries(board.peripherals)
      .filter(([_, val]) => !!val)
      .map(([key, val]) => ({
        key,
        label: peripheralLabel(key),
        description: peripheralDescription(key, val as Record<string, unknown>),
        iconPath: peripheralIconPath(key, (val as Record<string, unknown>)?.['icon'] as string | undefined),
      }));
  });

  updateFriendlyName(value: string) {
    this.editor.updateTopology((t) => {
      t.device.friendly_name = value;
      t.device.name = slug(value);
    });
  }

  clearAllPins(): void {
    this.editor.clearAllPins();
  }

  async changeBoard(boardId: string) {
    const board = await this.boards.load(boardId);
    this.editor.changeBoard(board);
  }

  protected getTimingValue(t: { timing: Record<string, number> }, field: TimingField): number {
    return field.key in t.timing ? t.timing[field.key] : (field.default as number);
  }

  protected fieldsByGroup(group: string): TimingField[] {
    return TIMING_FIELDS.filter((f) => f.group === group);
  }

  addProvider() {
    this.editor.updateTopology(t => {
      if (!t.device.io_providers) t.device.io_providers = [];
      const n = t.device.io_providers.length + 1;
      t.device.io_providers.push({
        id: `provider_${n}`,
        type: 'modbus_controller',
        config: { bus: '', address: 1 },
      });
    });
  }

  removeProvider(id: string) {
    this.editor.updateTopology(t => {
      t.device.io_providers = (t.device.io_providers ?? []).filter(p => p.id !== id);
    });
  }

  updateProviderId(oldId: string, newId: string) {
    if (!newId || oldId === newId) return;
    this.editor.updateTopology(t => {
      const prov = (t.device.io_providers ?? []).find(p => p.id === oldId);
      if (!prov) return;
      prov.id = newId;
      // Cascade: update all node fields that reference this provider by value
      for (const node of t.nodes) {
        const desc = NODE_REGISTRY.get(node.kind);
        if (!desc) continue;
        for (const field of desc.sidebarFields) {
          if (field.type !== 'pin') continue;
          const val = (node as Record<string, unknown>)[field.key];
          if (val === oldId || (typeof val === 'string' && val.startsWith(oldId + ':'))) {
            (node as Record<string, unknown>)[field.key] = val === oldId ? newId : newId + val.slice(oldId.length);
          }
        }
      }
    });
  }

  updateProviderType(id: string, type: string) {
    this.editor.updateTopology(t => {
      const prov = (t.device.io_providers ?? []).find(p => p.id === id);
      if (prov) { prov.type = type; prov.config = {}; }
    });
  }

  updateProviderConfig(id: string, key: string, value: unknown) {
    this.editor.updateTopology(t => {
      const prov = (t.device.io_providers ?? []).find(p => p.id === id);
      if (prov) (prov.config as Record<string, unknown>)[key] = value;
    });
  }

  updateTiming(key: string, value: number) {
    this.editor.updateTopology((t) => {
      (t.timing as Record<string, number>)[key] = value;
    });
  }
}
