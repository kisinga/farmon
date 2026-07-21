import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { BoardService } from '../../../core/services/board.service';
import { peripheralIconPath, peripheralLabel, peripheralDescription } from '../../../core/models/peripheral-icons';
import { BoardSvgComponent } from '../../../shared/board-svg/board-svg.component';
import { NODE_REGISTRY, TimingSchema, DeviceSchema, IoProviderDefSchema, COMPONENT_ID_POLICY } from '@core';
import { boardInputPins, resolveButtonAssignments, topologyToManifestForController } from '@core';
import type { UartBus, IoProviderInstanceConfig, LocalButton } from '@core';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';
import { SectionHeaderComponent } from '../shared/section-header.component';

interface TimingField {
  key: string;
  label: string;
  description: string;
  unit: string;
  default: number;
  group: string;
  min?: number;
  step?: number;
}

const TIMING_FIELDS: TimingField[] = [
  { key: 'valve_travel_time', label: 'Valve Travel Time', description: 'Time for motorized ball valves to fully open or close', unit: 'seconds', default: 15, group: 'Mechanical' },
  { key: 'flow_watchdog', label: 'Flow Watchdog Timeout', description: 'If no flow detected within this window, fault is raised', unit: 'seconds', default: 30, group: 'Safety' },
  { key: 'flow_confirm', label: 'Flow Confirmation Time', description: 'Sustained flow duration before marking flow as "confirmed"', unit: 'seconds', default: 15, group: 'Safety' },
  { key: 'flow_threshold', label: 'Flow Threshold', description: 'Minimum measured rate that counts as active flow', unit: 'L/min', default: 0.5, group: 'Safety', min: 0.1, step: 0.1 },
  { key: 'update_interval', label: 'Sensor Update Interval', description: 'How often ADC and diagnostic sensors are read (max 60s)', unit: 'seconds', default: 10, group: 'Calibration' },
];

@Component({
  selector: 'app-config-tab',
  standalone: true,
  imports: [FormsModule, BoardSvgComponent, ZodInputComponent, SectionHeaderComponent],
  template: `
    @if (editor.topology(); as t) {
      <div class="content-pane space-y-6">
        <app-section-header
          title="Config"
          subtitle="Identity, target board and pins, expansion buses, and the safety timings the firmware enforces." />

        <!-- Device identity -->
        <div class="card surface">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Device Identity</h2>
            <label class="flex flex-col">
              <div class="label"><span class="label-text font-medium">Friendly Name</span></div>
              <app-zod-input
                [schema]="deviceSchema"
                fieldKey="friendly_name"
                size="sm"
                [value]="editor.controllerDevice()?.friendly_name"
                (valueChange)="updateFriendlyName($any($event))" />
              <div class="label"><span class="label-text-alt text-base-content/60 font-mono">ESPHome ID: {{ editor.controllerDevice()?.name }}</span></div>
            </label>

          </div>
        </div>

        <!-- Board selection -->
        <div class="card surface">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Target Board</h2>
            <label class="flex flex-col">
              <div class="label"><span class="label-text font-medium">Board</span></div>
              <select
                class="select select-bordered select-sm"
                [ngModel]="editor.controllerDevice()?.board"
                (ngModelChange)="changeBoard($event)"
              >
                @for (b of boards.boards(); track b.model) {
                  <option [value]="b.model">{{ b.label }}</option>
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
                    [usages]="editor.activePinUsages()"
                  />
                </div>
              }
            }
          </div>
        </div>

        <!-- UART Buses -->
        <div class="card surface">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-base">UART Buses</h2>
              <button class="btn btn-sm btn-primary" (click)="addUartBus()">+ Add</button>
            </div>
            <!-- Board-native UART buses (read-only) -->
            @for (bus of editor.board()?.uart_buses ?? []; track bus.id) {
              <div class="border border-base-300/40 rounded-lg p-3 space-y-2 bg-base-200/30">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs">{{ bus.id }}</span>
                    <span class="badge badge-ghost badge-xs">built-in</span>
                  </div>
                </div>
                <div class="grid grid-cols-4 gap-2">
                  <label class="flex flex-col">
                    <span class="label-text text-xs">TX Pin</span>
                    <span class="text-xs font-mono">{{ bus.tx_pin }}</span>
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">RX Pin</span>
                    <span class="text-xs font-mono">{{ bus.rx_pin }}</span>
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">DE Pin</span>
                    <span class="text-xs font-mono">{{ bus.de_pin ?? '—' }}</span>
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">Baud Rate</span>
                    <span class="text-xs font-mono">{{ bus.baud_rate }}</span>
                  </label>
                </div>
              </div>
            }
            <!-- User-configured UART buses -->
            @for (bus of editor.controllerDevice()?.uart_buses ?? []; track bus.id) {
              <div class="border border-base-300/40 rounded-lg p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <input type="text" class="input input-xs input-bordered font-mono w-24"
                      [ngModel]="bus.id"
                      (ngModelChange)="updateUartBusId(bus.id, $event)" />
                  </div>
                  <button class="btn btn-ghost btn-xs text-error" (click)="removeUartBus(bus.id)">Remove</button>
                </div>
                <div class="grid grid-cols-4 gap-2">
                  <label class="flex flex-col">
                    <span class="label-text text-xs">TX Pin</span>
                    <input type="text" class="input input-xs input-bordered font-mono"
                      [ngModel]="bus.tx_pin"
                      (ngModelChange)="updateUartBusField(bus.id, 'tx_pin', $event)" />
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">RX Pin</span>
                    <input type="text" class="input input-xs input-bordered font-mono"
                      [ngModel]="bus.rx_pin"
                      (ngModelChange)="updateUartBusField(bus.id, 'rx_pin', $event)" />
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">DE Pin</span>
                    <input type="text" class="input input-xs input-bordered font-mono"
                      [ngModel]="bus.de_pin ?? ''"
                      (ngModelChange)="updateUartBusField(bus.id, 'de_pin', $event || undefined)" />
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">Baud Rate</span>
                    <input type="number" class="input input-xs input-bordered font-mono"
                      [ngModel]="bus.baud_rate"
                      (ngModelChange)="updateUartBusField(bus.id, 'baud_rate', +$event)" />
                  </label>
                </div>
              </div>
            }
            @if (!(editor.board()?.uart_buses ?? []).length && !(editor.controllerDevice()?.uart_buses ?? []).length) {
              <p class="text-sm text-base-content/50">No UART buses configured. Add one before creating Modbus devices.</p>
            }
          </div>
        </div>

        <!-- I/O Providers -->
        <div class="card surface">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-base">I/O Providers</h2>
              <button class="btn btn-sm btn-primary" (click)="addProvider()">+ Add</button>
            </div>
            @for (prov of editor.controllerDevice()?.io_providers ?? []; track prov.id) {
              <div class="border border-base-300/40 rounded-lg p-3 space-y-2">
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
                      @for (opt of expansionBoardOptions(); track opt.value) {
                        <option [value]="opt.value">{{ opt.label }}</option>
                      }
                    </select>
                  </div>
                  <button class="btn btn-ghost btn-xs text-error" (click)="removeProvider(prov.id)">Remove</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <label class="flex flex-col">
                    <span class="label-text text-xs">UART Bus</span>
                    <select class="select select-xs select-bordered font-mono"
                      [ngModel]="$any(prov.config)['bus']"
                      (ngModelChange)="updateProviderConfig(prov.id, 'bus', $event)">
                      <option value="">--</option>
                      @for (bus of editor.board()?.uart_buses ?? []; track bus.id) {
                        <option [value]="bus.id">{{ bus.id }} (built-in)</option>
                      }
                      @for (bus of editor.controllerDevice()?.uart_buses ?? []; track bus.id) {
                        @if (!(editor.board()?.uart_buses ?? []).some(b => b.id === bus.id)) {
                          <option [value]="bus.id">{{ bus.id }}</option>
                        }
                      }
                    </select>
                  </label>
                  <label class="flex flex-col">
                    <span class="label-text text-xs">Address</span>
                    <input type="number" class="input input-xs input-bordered font-mono"
                      [ngModel]="$any(prov.config)['address']"
                      (ngModelChange)="updateProviderConfig(prov.id, 'address', +$event)"
                      min="1" max="247" />
                  </label>
                </div>
              </div>
            }
            @if (!(editor.controllerDevice()?.io_providers ?? []).length) {
              <p class="text-sm text-base-content/50">No I/O providers configured.</p>
            }
          </div>
        </div>

        <!-- Panel Buttons (only on boards with digital-input expanders) -->
        @if (inputPins().length > 0) {
          <div class="card surface">
            <div class="card-body gap-4">
              <div class="flex items-center justify-between">
                <h2 class="card-title text-base">Panel Buttons</h2>
                @if (customButtonMapping()) {
                  <button class="btn btn-ghost btn-xs" (click)="resetButtonMapping()">Reset to automatic</button>
                }
              </div>
              <p class="text-sm text-base-content/50">
                Physical buttons on the board's digital inputs. Route buttons toggle start/stop.
                {{ customButtonMapping() ? 'Custom mapping — it overrides the automatic assignment.' : 'Automatic: Stop All on the first input, routes in order after it.' }}
              </p>
              <div class="divide-y divide-base-300/30">
                <div class="flex items-center gap-4 py-2">
                  <span class="flex-1 text-sm font-medium">Stop All</span>
                  <select class="select select-xs select-bordered font-mono w-24"
                    [ngModel]="buttonInputForStopAll()"
                    (ngModelChange)="setButtonInput('stop_all', null, $event)">
                    <option value="">—</option>
                    @for (p of inputPins(); track p) {
                      <option [value]="p">{{ p }}</option>
                    }
                  </select>
                </div>
                @for (r of panelRoutes(); track r.key; let i = $index) {
                  <div class="flex items-center gap-4 py-2">
                    <span class="flex-1 text-sm">Start / stop {{ r.name }}</span>
                    <select class="select select-xs select-bordered font-mono w-24"
                      [ngModel]="buttonInputForRoute(i)"
                      (ngModelChange)="setButtonInput('route_start', r.key, $event)">
                      <option value="">—</option>
                      @for (p of inputPins(); track p) {
                        <option [value]="p">{{ p }}</option>
                      }
                    </select>
                  </div>
                }
              </div>
            </div>
          </div>
        }

        <!-- On-device features -->
        <div class="card surface">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">On-Device Features</h2>
            <p class="text-sm text-base-content/50">
              The controller runs these by itself — they keep working even if the internet or this app is down.
            </p>
            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" class="toggle toggle-sm toggle-primary mt-0.5 shrink-0"
                [ngModel]="localUi()"
                (ngModelChange)="setLocalFlag('ui', $event)" />
              <span>
                <span class="text-sm font-medium block">On-device dashboard</span>
                <span class="text-xs text-base-content/60">The controller serves the full dashboard on your local network — no cloud needed.</span>
              </span>
            </label>
            @if (boardHasI2c()) {
              <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" class="toggle toggle-sm toggle-primary mt-0.5 shrink-0"
                  [ngModel]="localRtc()"
                  (ngModelChange)="setLocalFlag('rtc', $event)" />
                <span>
                  <span class="text-sm font-medium block">RTC clock chip (DS3231)</span>
                  <span class="text-xs text-base-content/60">With the clock chip fitted, time-based schedules run with no internet at all.</span>
                </span>
              </label>
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
          <div class="card surface">
            <div class="card-body gap-3">
              <h3 class="font-semibold text-sm text-base-content/60 uppercase tracking-wider">{{ group }}</h3>
              <div class="divide-y divide-base-300/30">
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
                          [min]="field.min ?? 2"
                          [step]="field.step ?? 1"
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
  /** Expansion-board picker options, sourced from the DB catalog (kind=expansion). */
  protected expansionBoardOptions = computed(() =>
    this.boards.boards()
      .filter((b) => b.kind === 'expansion')
      .map((b) => ({ value: b.model, label: b.label })),
  );


  protected peripherals = computed(() => {
    const board = this.editor.board();
    if (!board) return [];
    // Some boards (e.g. RS-485 expansion boards) have no onboard peripherals.
    return Object.entries(board.peripherals ?? {})
      .filter(([_, val]) => !!val)
      .map(([key, val]) => ({
        key,
        label: peripheralLabel(key),
        description: peripheralDescription(key, val as Record<string, unknown>),
        iconPath: peripheralIconPath(key, (val as Record<string, unknown>)?.['icon'] as string | undefined),
      }));
  });

  updateFriendlyName(value: string) {
    // `name` is derived by `controllerDevice` via `slug(friendlyName)` — no need to write it back.
    this.editor.updateActiveController((ctrl) => {
      ctrl.friendlyName = value;
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
    this.editor.updateActiveController(ctrl => {
      if (!ctrl.io_providers) ctrl.io_providers = [];
      const n = ctrl.io_providers.length + 1;
      ctrl.io_providers.push({
        id: `provider_${n}`,
        type: 'modbus_controller',
        config: { bus: '', address: 1 },
      });
    });
  }

  removeProvider(id: string) {
    this.editor.updateActiveController(ctrl => {
      ctrl.io_providers = (ctrl.io_providers ?? []).filter(p => p.id !== id);
    });
  }

  updateProviderId(oldId: string, newId: string) {
    if (!newId || oldId === newId) return;
    const cid = this.editor.controllerId();
    if (!cid) return;
    this.editor.updateTopology(t => {
      const ctrl = t.controllers.find(c => c.id === cid);
      if (!ctrl) return;
      const prov = (ctrl.io_providers ?? []).find(p => p.id === oldId);
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
    this.editor.updateActiveController(ctrl => {
      const prov = (ctrl.io_providers ?? []).find(p => p.id === id);
      if (!prov) return;
      prov.type = type;
      prov.config = { bus: '', address: 1 };
    });
  }

  updateProviderConfig<K extends keyof IoProviderInstanceConfig>(id: string, key: K, value: IoProviderInstanceConfig[K]) {
    this.editor.updateActiveController(ctrl => {
      const prov = (ctrl.io_providers ?? []).find(p => p.id === id);
      if (prov) prov.config[key] = value;
    });
  }

  updateTiming(key: string, value: number) {
    this.editor.updateTopology((t) => {
      (t.timing as Record<string, number>)[key] = value;
    });
  }

  // --- Panel buttons (route→button mapping on the board's digital inputs) ---

  /** Board digital-input pins ('IN1'…) — [] when the board has no input expanders. */
  protected inputPins = computed(() => {
    const board = this.editor.board();
    return board ? boardInputPins(board) : [];
  });

  /** Routes of the active controller in manifest order (== firmware route ids). */
  protected panelRoutes = computed(() => {
    const t = this.editor.topology();
    const cid = this.editor.controllerId();
    if (!t || !cid) return [];
    try {
      return topologyToManifestForController(t, cid).routes.map(r => ({ key: r.key, name: r.name }));
    } catch {
      return [];
    }
  });

  /** Effective mapping (explicit local.buttons, else the default auto-assign). */
  protected buttonAssignments = computed(() =>
    resolveButtonAssignments(this.panelRoutes(), this.inputPins(), this.editor.activeController()?.local),
  );

  protected customButtonMapping = computed(() => !!this.editor.activeController()?.local?.buttons?.length);

  protected buttonInputForStopAll(): string {
    return this.buttonAssignments().find(a => a.action === 'stop_all')?.input ?? '';
  }

  protected buttonInputForRoute(routeIndex: number): string {
    return this.buttonAssignments().find(a => a.routeIndex === routeIndex)?.input ?? '';
  }

  /**
   * Write the current row state as an explicit local.buttons mapping. Editing
   * any row forks the automatic mapping into an explicit one; clearing every
   * row returns to automatic (an empty mapping IS the auto-assign).
   */
  protected setButtonInput(action: 'route_start' | 'stop_all', routeKey: string | null, input: string) {
    const rows = [
      { action: 'stop_all' as const, route: undefined as string | undefined, input: this.buttonInputForStopAll() },
      ...this.panelRoutes().map((r, i) => ({ action: 'route_start' as const, route: r.key, input: this.buttonInputForRoute(i) })),
    ];
    const target = action === 'stop_all' ? rows[0] : rows.find(r => r.route === routeKey);
    if (target) target.input = input;
    // First row wins on a duplicate input (mirrors resolveButtonAssignments).
    const seen = new Set<string>();
    const buttons: LocalButton[] = [];
    for (const r of rows) {
      if (!r.input || seen.has(r.input)) continue;
      seen.add(r.input);
      buttons.push(r.action === 'stop_all'
        ? { input: r.input, action: 'stop_all' }
        : { input: r.input, action: 'route_start', route: r.route });
    }
    this.editor.updateActiveController(ctrl => {
      ctrl.local = { ...ctrl.local, buttons: buttons.length ? buttons : undefined };
    });
  }

  protected resetButtonMapping() {
    this.editor.updateActiveController(ctrl => {
      if (ctrl.local) ctrl.local.buttons = undefined;
    });
  }

  // --- On-device features (local.ui / local.rtc) ---

  protected localUi = computed(() => this.editor.activeController()?.local?.ui === true);
  protected localRtc = computed(() => this.editor.activeController()?.local?.rtc === true);

  /** The RTC chip rides the board's i2c bus — only offer the toggle when the board has one. */
  protected boardHasI2c = computed(() => !!this.editor.board()?.buses?.['i2c']);

  protected setLocalFlag(key: 'ui' | 'rtc', enabled: boolean) {
    this.editor.updateActiveController(ctrl => {
      const local = { ...ctrl.local, [key]: enabled || undefined };
      // Back to defaults everywhere — drop `local` entirely.
      ctrl.local = local.buttons?.length || local.ui || local.rtc ? local : undefined;
    });
  }

  addUartBus() {
    this.editor.updateActiveController(ctrl => {
      if (!ctrl.uart_buses) ctrl.uart_buses = [];
      const n = ctrl.uart_buses.length + 1;
      ctrl.uart_buses.push({
        id: `uart_${n}`,
        tx_pin: '',
        rx_pin: '',
        baud_rate: 9600,
      });
    });
  }

  removeUartBus(id: string) {
    this.editor.updateActiveController(ctrl => {
      ctrl.uart_buses = (ctrl.uart_buses ?? []).filter(b => b.id !== id);
    });
  }

  updateUartBusId(oldId: string, newId: string) {
    if (!newId || oldId === newId) return;
    const cid = this.editor.controllerId();
    if (!cid) return;
    this.editor.updateTopology(t => {
      const ctrl = t.controllers.find(c => c.id === cid);
      if (!ctrl) return;
      const bus = (ctrl.uart_buses ?? []).find(b => b.id === oldId);
      if (bus) bus.id = newId;
      // Cascade: update provider configs that reference this bus
      for (const prov of ctrl.io_providers ?? []) {
        if (prov.config.bus === oldId) prov.config.bus = newId;
      }
    });
  }

  updateUartBusField<K extends keyof UartBus>(id: string, key: K, value: UartBus[K]) {
    this.editor.updateActiveController(ctrl => {
      const bus = (ctrl.uart_buses ?? []).find(b => b.id === id);
      if (bus) bus[key] = value;
    });
  }
}
