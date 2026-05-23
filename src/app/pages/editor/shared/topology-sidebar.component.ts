import { Component, inject, input, output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ValidationPanelComponent } from '../../../shared/validation-panel/validation-panel.component';
import type { RuleDiagnostic } from '../../../core/models/electron-api';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import type { DerivedRoute } from './derive-routes';
import { buildGraph, activeGraph, deriveRoutes, RouteOverrideSchema, deriveHaEntityId, deriveTankCalibration, recommendSensorMaxPsi } from '@far-mon/core';
import type { PinCap } from '@far-mon/core';
import type { RouteOverride } from '../../../core/models/topology.model';
import { routeLevelInfo } from './route-level-info';
import type { Selection } from './selection';
import { ZodFieldDirective } from '../../../core/utils/field-validation';
import { FieldErrorComponent } from '../../../shared/field-error/field-error.component';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';
export type { Selection };

@Component({
  selector: 'app-topology-sidebar',
  standalone: true,
  imports: [FormsModule, ValidationPanelComponent, ZodFieldDirective, FieldErrorComponent, ZodInputComponent],
  template: `
    <!-- Node properties (data-driven) -->
    @if (selectedNodeData(); as sn) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">{{ sn.desc.label }}
          @if (sn.desc.experimental) { <span class="badge badge-ghost badge-xs ml-1">experimental</span> }
        </h3>
        <div class="sidebar-fields">
          <!-- Standard fields: Name + ID (all entities) -->
          <label class="sidebar-label">Name</label>
          <div class="sidebar-control">
            <app-zod-input
              [schema]="sn.desc.schema"
              fieldKey="name"
              inputClass="w-full font-mono"
              [value]="$any(sn.node).name"
              (valueChange)="updateField.emit({ nodeId: sn.node.id, field: 'name', value: $event })" />
          </div>
          <label class="sidebar-label">Enabled</label>
          <input type="checkbox" class="toggle toggle-xs toggle-success"
            [ngModel]="!$any(sn.node).disabled"
            (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: 'disabled', value: !$event })" />
          <!-- Entity-specific fields -->
          @for (field of sn.desc.sidebarFields; track field.key) {
            @if (!$any(sn.node).remote || field.type !== 'pin') {
            <label class="sidebar-label">{{ field.label }}</label>
            <div class="sidebar-control">
              @if (field.type === 'pin') {
                <!-- Hidden mirror control: holds the real pin value, carries the validator -->
                <input type="hidden"
                  [name]="'pin-' + sn.node.id + '-' + field.key"
                  [ngModelOptions]="{ standalone: true }"
                  [zodField]="{ schema: sn.desc.schema, key: field.key }"
                  #pinCtrl="ngModel"
                  [ngModel]="$any(sn.node)[field.key] ?? ''"
                  (ngModelChange)="$event" />
                <!-- Two-step channel selector: transport group → channel -->
                <div class="flex gap-1"
                  [class.pin-invalid]="pinCtrl.touched && pinCtrl.invalid">
                  <select class="select select-xs select-bordered flex-1 font-mono min-w-0"
                    [class.select-warning]="!(pinCtrl.touched && pinCtrl.invalid) && !$any(sn.node)[field.key]"
                    [ngModel]="activeGroup(sn.node.id, field.key, $any(sn.node)[field.key] ?? '', field.pinCap)"
                    [ngModelOptions]="{ standalone: true }"
                    [name]="'grp-' + sn.node.id + '-' + field.key"
                    (ngModelChange)="onTransportChange(sn.node.id, field.key, $event, field.pinCap)"
                    (blur)="pinCtrl.control.markAsTouched()">
                    <option value="">-- transport --</option>
                    @for (group of editor.channelGroups(field.pinCap); track group.provider) {
                      <option [value]="group.provider">{{ group.label }}</option>
                    }
                  </select>
                  @if (activeGroupChannels(sn.node.id, field.key, $any(sn.node)[field.key] ?? '', field.pinCap); as channels) {
                    @if (channels.length > 1) {
                      <select class="select select-xs select-bordered flex-1 font-mono min-w-0"
                        [name]="'ch-' + sn.node.id + '-' + field.key"
                        [ngModelOptions]="{ standalone: true }"
                        [ngModel]="$any(sn.node)[field.key]"
                        (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })"
                        (blur)="pinCtrl.control.markAsTouched()">
                        <option value="">-- channel --</option>
                        @for (ch of channels; track ch.id) {
                          <option [value]="ch.id" [disabled]="!!ch.usedBy">
                            {{ ch.label }}{{ ch.usedBy ? ' (' + ch.usedBy + ')' : '' }}
                          </option>
                        }
                      </select>
                    }
                  }
                </div>
                <app-field-error [control]="pinCtrl" />
              } @else if (field.type === 'number') {
                <app-zod-input
                  [schema]="sn.desc.schema"
                  [fieldKey]="field.key"
                  type="number"
                  inputClass="w-full font-mono"
                  [placeholder]="field.placeholder"
                  [min]="0"
                  [value]="$any(sn.node)[field.key]"
                  (valueChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })" />
              } @else if (field.type === 'select') {
                <select class="select select-xs select-bordered w-full font-mono"
                  [name]="'sel-' + sn.node.id + '-' + field.key"
                  [ngModelOptions]="{ standalone: true }"
                  [ngModel]="$any(sn.node)[field.key]"
                  (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })">
                  @for (opt of field.options ?? []; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }}</option>
                  }
                </select>
                @if (field.key === 'relay_polarity' || field.key === 'coil_polarity') {
                  <div class="text-[10px] text-base-content/40 mt-1">
                    Active-low: relay turns ON when GPIO is LOW (most opto-isolated modules). Active-high: turns ON when GPIO is HIGH. Pick whichever matches your module so the load is OFF at MCU power-off.
                  </div>
                }
              } @else if (field.type === 'toggle') {
                <input type="checkbox" class="toggle toggle-xs toggle-success"
                  [name]="'tog-' + sn.node.id + '-' + field.key"
                  [ngModelOptions]="{ standalone: true }"
                  [ngModel]="!!$any(sn.node)[field.key]"
                  (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })" />
              } @else {
                <app-zod-input
                  [schema]="sn.desc.schema"
                  [fieldKey]="field.key"
                  inputClass="w-full font-mono"
                  [policy]="field.inputPolicy"
                  [placeholder]="field.placeholder"
                  [value]="$any(sn.node)[field.key]"
                  (valueChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })" />
              }
            </div>
            @if (field.hint) {
              <div class="sidebar-hint">{{ field.hint }}</div>
            }
            }
          }
        </div>

        <!-- Pressure sensor: derived calibration readout (read-only, computed from inputs). -->
        @if (sn.node.kind === 'pressure_sensor') {
          @if (pressureSensorReadout(sn.node); as r) {
            <div class="mt-3 pt-3 border-t border-base-300/30">
              <h4 class="sidebar-title">Derived Calibration</h4>
              @if (r.cal) {
                <div class="sidebar-fields">
                  <span class="sidebar-label">P empty</span>
                  <span class="text-xs font-mono">{{ r.cal.p_empty_psi.toFixed(2) }} psi</span>
                  <span class="sidebar-label">P full</span>
                  <span class="text-xs font-mono">{{ r.cal.p_full_psi.toFixed(2) }} psi</span>
                  <span class="sidebar-label">Working span</span>
                  <span class="text-xs font-mono">{{ r.cal.working_span_psi.toFixed(2) }} psi</span>
                  <span class="sidebar-label">Recommended max</span>
                  <span class="text-xs font-mono">≥ {{ r.recommended }} psi</span>
                  <span class="sidebar-label">Sensor utilisation</span>
                  <span class="text-xs font-mono">
                    swing {{ r.swingPct.toFixed(0) }}%
                    <span [class.text-warning]="r.swingPct < 30">
                      @if (r.swingPct < 30) { (low resolution) }
                    </span>
                  </span>
                  <span class="sidebar-label">Headroom</span>
                  <span class="text-xs font-mono">
                    {{ r.headroomPct.toFixed(0) }}%
                    <span [class.text-warning]="r.headroomPct < 30" [class.text-error]="r.headroomPct < 0">
                      @if (r.headroomPct < 0) { (over range) }
                      @else if (r.headroomPct < 30) { (tight) }
                    </span>
                  </span>
                </div>
              } @else {
                <div class="text-[10px] text-base-content/50">
                  Enter tank height to derive calibration. Without it, this sensor measures line pressure only — Cal Empty / Cal Full must be set manually in Home Assistant.
                </div>
              }
            </div>
          }
        }

        <!-- Home Assistant entity mapping (SCADA export) — derived, not editable. -->
        @if (sn.desc.haDomain && device(); as dev) {
          <div class="mt-3 pt-3 border-t border-base-300/30">
            <h4 class="sidebar-title">Home Assistant</h4>
            <div class="sidebar-fields">
              <label class="sidebar-label">Entity ID</label>
              <code class="text-xs font-mono text-base-content/70 select-all break-all">{{ deriveHaEntityId(sn.desc.haDomain, dev, $any(sn.node).name) }}</code>
            </div>
            <div class="text-[10px] text-base-content/40 mt-1">
              Auto-derived from friendly name. Edit the entity's name to change.
            </div>
          </div>
        }

        @if (!sn.desc.singleton) {
          <button class="btn btn-error btn-xs mt-3 w-full" (click)="deleteNode.emit(sn.node.id)">Delete {{ sn.desc.label }}</button>
        }
      </div>
    }

    <!-- Pipe properties -->
    @if (selectedPipeData(); as pipeData) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">Pipe</h3>
        <div class="text-xs font-mono text-base-content/60 mb-2">{{ pipeData.pipe.from }} &rarr; {{ pipeData.pipe.to }}</div>
        <button class="btn btn-error btn-xs w-full" (click)="deletePipe.emit(pipeData.pipe.id)">Delete Pipe</button>
      </div>
    }

    <!-- Routes (always visible) -->
    <div class="sidebar-section">
      <h3 class="sidebar-title">Derived Routes</h3>
      @if (derivedRoutes().length === 0) {
        <div class="text-base-content/40 text-center py-4 text-xs">No routes derived yet.<br>Connect nodes with pipes.</div>
      } @else {
        @for (route of derivedRoutes(); track route.key) {
          <div class="route-row flex items-center justify-between py-1.5 border-b border-base-300/20 cursor-pointer hover:bg-base-200/50 px-2 -mx-1 rounded"
            (click)="onRouteClick(route)">
            <span class="font-mono text-xs flex items-center gap-1.5">
              <span class="text-base-content/30 text-[9px]">&#x25B6;</span>
              {{ route.key }}
            </span>
            @if (hasErrorDiagnostics(route.key)) {
              <span class="badge badge-error badge-xs">Error</span>
            } @else if (hasWarningDiagnostics(route.key)) {
              <span class="badge badge-warning badge-xs">Warning</span>
            } @else if (!route.valid) {
              <span class="badge badge-ghost badge-xs">Passive</span>
            } @else if (hasInfoDiagnostics(route.key)) {
              <span class="badge badge-info badge-xs">Info</span>
            } @else {
              <span class="badge badge-success badge-xs">Valid</span>
            }
          </div>
        }
      }
    </div>

    @if (!selection()) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">Route Overrides</h3>
        @if (overrideEntries().length === 0) {
          <div class="text-base-content/40 text-center py-4 text-xs">No overrides defined.</div>
        } @else {
          @for (entry of overrideEntries(); track entry.key) {
            <div class="card bg-base-200/40 mb-2">
              <div class="card-body p-2 gap-1">
                <span class="font-mono font-semibold text-xs">{{ entry.key }}</span>
                <div class="flex items-center gap-2">
                  <label class="text-[10px] text-base-content/50">Default Max Runtime</label>
                  <!-- Operator-facing unit is minutes; storage stays in seconds
                       (max_runtime_seconds) so the manifest and firmware are
                       unchanged. View → seconds happens in onMaxRuntimeChange. -->
                  <input type="number" class="input input-xs input-bordered w-20 font-mono"
                    min="1" max="120" step="1"
                    [name]="'rt-' + entry.key"
                    [ngModelOptions]="{ standalone: true }"
                    [ngModel]="maxRuntimeMinutes(entry.override.max_runtime_seconds)"
                    (ngModelChange)="onMaxRuntimeMinutesChange(entry.key, $event)" />
                  <span class="text-[10px] text-base-content/50">min</span>
                </div>
                @if (entry.sourceHasLevel) {
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-base-content/50">Default Source Min</label>
                    <app-zod-input
                      [schema]="routeOverrideSchema"
                      fieldKey="source_min_level"
                      type="number"
                      inputClass="w-16 font-mono"
                      placeholder="—"
                      [min]="0"
                      [max]="100"
                      [value]="entry.override.source_min_level"
                      (valueChange)="updateRouteOverride.emit({ key: entry.key, field: 'source_min_level', value: $any($event) })" />
                    <span class="text-[10px] text-base-content/50">%</span>
                  </div>
                }
                @if (entry.destHasLevel) {
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-base-content/50">Default Dest Max</label>
                    <app-zod-input
                      [schema]="routeOverrideSchema"
                      fieldKey="dest_max_level"
                      type="number"
                      inputClass="w-16 font-mono"
                      placeholder="—"
                      [min]="0"
                      [max]="100"
                      [value]="entry.override.dest_max_level"
                      (valueChange)="updateRouteOverride.emit({ key: entry.key, field: 'dest_max_level', value: $any($event) })" />
                    <span class="text-[10px] text-base-content/50">%</span>
                  </div>
                }
                <div class="text-[10px] text-base-content/45 mt-1 leading-snug">
                  Initial values — adjust live in Home Assistant.
                </div>
              </div>
            </div>
          }
        }
      </div>
    }

    <!-- Validation summary (always visible) -->
    <div class="sidebar-section">
      <h3 class="sidebar-title">Validation</h3>
      <app-validation-panel
        [result]="editor.validation()"
        [gpioUsage]="editor.gpioUsage()"
        (selectTarget)="selectNode.emit($event)"
      />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-size: 12px;
    }
    .sidebar-section { padding: 12px; border-bottom: 1px solid oklch(var(--b3) / 0.3); }
    .sidebar-title {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: oklch(var(--bc) / 0.5); margin-bottom: 8px;
    }
    .sidebar-fields { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: start; }
    .sidebar-label { font-size: 10px; color: oklch(var(--bc) / 0.5); white-space: nowrap; padding-top: 4px; }
    .sidebar-control { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sidebar-hint {
      grid-column: 1 / -1;
      font-size: 10px; line-height: 1.35;
      color: oklch(var(--bc) / 0.45);
      margin: 2px 0 6px;
    }
  `],
})
export class TopologySidebarComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
  protected routeOverrideSchema = RouteOverrideSchema;
  protected deriveHaEntityId = deriveHaEntityId;
  protected device = computed(() => this.editor.topology()?.device ?? null);

  // --- Inputs ---
  selection = input<Selection | null>(null);

  // --- Outputs ---
  deleteNode = output<string>();
  deletePipe = output<string>();
  updateField = output<{ nodeId: string; field: string; value: any }>();
  updateRouteOverride = output<{ key: string; field: keyof RouteOverride; value: number | undefined }>();
  selectRoute = output<{ route: DerivedRoute; sharedNodeIds?: string[] }>();
  selectNode = output<string>();

  // --- Computed ---
  protected selectedNodeData = computed(() => {
    const sel = this.selection();
    const t = this.editor.topology();
    if (!sel || sel.kind !== 'node' || !t) return null;
    const node = t.nodes.find(n => n.id === sel.nodeId);
    if (!node) return null;
    const desc = NODE_REGISTRY.get(node.kind);
    return desc ? { node, desc } : null;
  });

  protected selectedPipeData = computed(() => {
    const sel = this.selection();
    const t = this.editor.topology();
    if (!sel || sel.kind !== 'pipe' || !t) return null;
    const pipe = t.pipes.find(p => p.id === sel.pipeId);
    return pipe ? { pipe } : null;
  });

  protected derivedRoutes = computed(() => {
    const t = this.editor.topology();
    if (!t) return [];
    const g = activeGraph(buildGraph(t.nodes, t.pipes));
    return deriveRoutes(g);
  });

  protected overrideEntries = computed(() => {
    const t = this.editor.topology();
    if (!t) return [];
    return Object.entries(t.route_overrides ?? {}).map(([key, override]) => ({
      key,
      override,
      ...routeLevelInfo(key, t.nodes, t.pipes),
    }));
  });

  /** Other systems in the site (for the target dropdown) */
  protected otherSystems = computed(() => {
    const systemId = this.workspace.activeSystemId();
    const systems = this.workspace.systems();
    if (!systemId) return [];
    return [...systems.entries()]
      .filter(([id]) => id !== systemId)
      .map(([id, { topology }]) => ({
        config: id,
        friendlyName: topology.device.friendly_name ?? id,
      }));
  });

  // --- Two-step channel selector helpers ---

  /** Tracks user's transport group selection per field (survives value clearing). */
  private selectedGroups = new Map<string, string>();

  /** Resolve active group: explicit selection > derived from value > empty. */
  protected activeGroup(nodeId: string, fieldKey: string, currentValue: string, cap?: PinCap): string {
    const key = `${nodeId}:${fieldKey}`;
    const explicit = this.selectedGroups.get(key);
    if (explicit) return explicit;
    if (!currentValue) return '';
    const groups = this.editor.channelGroups(cap);
    for (const g of groups) {
      if (g.channels.some(ch => ch.id === currentValue)) return g.provider;
    }
    return '';
  }

  /** Channels in the active group for step 2. */
  protected activeGroupChannels(nodeId: string, fieldKey: string, currentValue: string, cap?: PinCap): Array<{ id: string; label: string; caps: PinCap[]; usedBy?: string }> {
    const groupId = this.activeGroup(nodeId, fieldKey, currentValue, cap);
    if (!groupId) return [];
    const groups = this.editor.channelGroups(cap);
    const group = groups.find(g => g.provider === groupId);
    return group?.channels ?? [];
  }

  /** When transport group changes, auto-select if single channel or clear. */
  protected onTransportChange(nodeId: string, field: string, groupId: string, cap?: PinCap) {
    const key = `${nodeId}:${field}`;
    this.selectedGroups.set(key, groupId);
    if (!groupId) { this.updateField.emit({ nodeId, field, value: '' }); return; }
    const groups = this.editor.channelGroups(cap);
    const group = groups.find(g => g.provider === groupId);
    if (!group) { this.updateField.emit({ nodeId, field, value: '' }); return; }
    if (group.channels.length === 1) {
      this.updateField.emit({ nodeId, field, value: group.channels[0].id });
    } else {
      this.updateField.emit({ nodeId, field, value: '' });
    }
  }

  // --- Pressure-sensor derived readout ---

  /**
   * Compute the derived calibration panel for a pressure-sensor node. Returns
   * null when sensor_max_psi is missing (impossible after schema validation,
   * but the form lets fields be cleared transiently); returns `cal: null`
   * when no upstream tank with `height_m` is connected (line-pressure mode).
   *
   * Tank dimensions live on the tank node — walk one hop upstream in the
   * topology graph from the sensor to find the parent tank's `height_m`.
   */
  protected pressureSensorReadout(node: any): {
    cal: { p_empty_psi: number; p_full_psi: number; working_span_psi: number } | null;
    recommended: number;
    swingPct: number;
    headroomPct: number;
  } | null {
    const sensorMax = Number(node.sensor_max_psi);
    if (!Number.isFinite(sensorMax) || sensorMax <= 0) return null;
    const tankHeight = this.upstreamTankHeight(node.id);
    if (tankHeight == null || tankHeight <= 0) {
      return { cal: null, recommended: 0, swingPct: 0, headroomPct: 0 };
    }
    const elevation = Number(node.elevation_m ?? 0);
    const cal = deriveTankCalibration(tankHeight, Number.isFinite(elevation) ? elevation : 0);
    return {
      cal,
      recommended: recommendSensorMaxPsi(cal.p_full_psi),
      swingPct: (cal.working_span_psi / sensorMax) * 100,
      headroomPct: ((sensorMax - cal.p_full_psi) / sensorMax) * 100,
    };
  }

  /**
   * Walk upstream from `nodeId` through pass-through nodes (valves, inline
   * sensors, filters …) until we hit a tank, and return its `height_m`.
   *
   * A pump or VFD encountered along the way decouples the sensor from the
   * tank's static column — return `undefined` in that case. Likewise
   * `undefined` if we reach a non-tank terminal (water source, endpoint) or
   * run out of pipes.
   */
  private upstreamTankHeight(nodeId: string): number | undefined {
    const t = this.editor.topology();
    if (!t) return undefined;
    const visited = new Set<string>();
    let currentId: string | undefined = nodeId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const inbound = t.pipes.find(p => p.to.split(':')[0] === currentId);
      if (!inbound) return undefined;
      const upstreamId = inbound.from.split(':')[0];
      const upstream = t.nodes.find(n => n.id === upstreamId);
      if (!upstream) return undefined;
      if (upstream.kind === 'tank') {
        const h = (upstream as { height_m?: number }).height_m;
        return typeof h === 'number' ? h : undefined;
      }
      // Pumps / VFDs sit between the tank and the sensor and break the
      // hydraulic column — sensor below them doesn't read tank head.
      if (upstream.kind === 'pump' || upstream.kind === 'vfd') return undefined;
      currentId = upstreamId;
    }
    return undefined;
  }

  // --- Route override unit conversion ---

  /** Display value (minutes) for a stored max_runtime_seconds. */
  protected maxRuntimeMinutes(seconds: number | undefined): number {
    return Math.max(1, Math.round((seconds ?? 1800) / 60));
  }

  /** Persist a minutes-input change as the seconds value the schema expects. */
  protected onMaxRuntimeMinutesChange(key: string, minutes: unknown): void {
    const m = Number(minutes);
    const seconds = Number.isFinite(m) && m > 0 ? Math.round(m * 60) : undefined;
    this.updateRouteOverride.emit({ key, field: 'max_runtime_seconds', value: seconds });
  }

  // --- Route & validation helpers ---

  routeDiagnostics(routeKey: string): RuleDiagnostic[] {
    return this.editor.diagnosticsByTarget().get(routeKey) ?? [];
  }

  hasErrorDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'error');
  }

  hasWarningDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'warning');
  }

  hasInfoDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'info');
  }

  onRouteClick(route: DerivedRoute) {
    const diags = this.routeDiagnostics(route.key);
    const sharedNodeIds = [...new Set(diags.flatMap(d => d.sharedNodeIds ?? []))];
    this.selectRoute.emit({ route, sharedNodeIds: sharedNodeIds.length ? sharedNodeIds : undefined });
  }
}
