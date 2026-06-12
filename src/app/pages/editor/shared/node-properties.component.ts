import { Component, inject, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { deriveTankCalibration, recommendSensorMaxPsi } from '@core';
import type { PinCap, FieldDef } from '@core';
import type { TopologyNode } from '../../../core/models/topology.model';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import { ZodFieldDirective } from '../../../core/utils/field-validation';
import { FieldErrorComponent } from '../../../shared/field-error/field-error.component';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';

/**
 * Editable property panel for the selected topology node: name / controller /
 * enabled, the entity-declared field list (including the two-step pin/channel
 * selector), derived tank-pressure calibration readouts, and the "imported by"
 * summary. Mounted by `topology-sidebar` only when a node is selected; emits
 * `updateField` / `deleteNode` back up to the editor.
 */
@Component({
  selector: 'app-node-properties',
  standalone: true,
  imports: [FormsModule, ZodFieldDirective, FieldErrorComponent, ZodInputComponent],
  template: `
    <div class="sidebar-section">
      <button class="sidebar-title w-full flex items-center justify-between" (click)="toggleNode()">
        <span>{{ desc().label }}
        @if (desc().experimental) { <span class="badge badge-ghost badge-xs ml-1">experimental</span> }
        @if (isRemoteNode(node())) {
          <span class="badge badge-ghost badge-xs ml-1">Remote: {{ controllerNameFor(node()) }}</span>
        }</span>
        <span class="text-[10px]">{{ expanded() ? '▼' : '▶' }}</span>
      </button>
      @if (expanded()) {
      <div class="sidebar-fields">
        <!-- Standard fields: Name + Controller + Enabled -->
        <label class="sidebar-label">Name</label>
        <div class="sidebar-control">
          <app-zod-input
            [schema]="desc().schema"
            fieldKey="name"
            inputClass="w-full font-mono"
            [value]="$any(node()).name"
            (valueChange)="updateField.emit({ nodeId: node().id, field: 'name', value: $event })" />
        </div>
        <label class="sidebar-label">Controller</label>
        <select class="select select-xs select-bordered w-full font-mono"
          [ngModel]="$any(node()).anchorId"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="updateField.emit({ nodeId: node().id, field: 'anchorId', value: $event })">
          @for (ctrl of allControllers(); track ctrl.id) {
            <option [value]="ctrl.id">{{ ctrl.friendlyName }}</option>
          }
        </select>
        <label class="sidebar-label">Enabled</label>
        <input type="checkbox" class="toggle toggle-xs toggle-success"
          [ngModel]="!$any(node()).disabled"
          (ngModelChange)="updateField.emit({ nodeId: node().id, field: 'disabled', value: !$event })" />
        <!-- Entity-specific fields -->
        @for (field of desc().sidebarFields; track field.key) {
          @if (isFieldVisible(field, $any(node())) && (!isRemoteNode(node()) || field.type !== 'pin')) {
          <label class="sidebar-label">{{ field.label }}</label>
          <div class="sidebar-control">
            @if (field.type === 'pin') {
              <!-- Hidden mirror control: holds the real pin value, carries the validator -->
              <input type="hidden"
                [name]="'pin-' + node().id + '-' + field.key"
                [ngModelOptions]="{ standalone: true }"
                [zodField]="{ schema: desc().schema, key: field.key }"
                #pinCtrl="ngModel"
                [ngModel]="$any(node())[field.key] ?? ''"
                (ngModelChange)="$event" />
              <!-- Two-step channel selector: transport group → channel -->
              <div class="flex gap-1"
                [class.pin-invalid]="pinCtrl.touched && pinCtrl.invalid">
                <select class="select select-xs select-bordered flex-1 font-mono min-w-0"
                  [class.select-warning]="!(pinCtrl.touched && pinCtrl.invalid) && !$any(node())[field.key]"
                  [ngModel]="activeGroup(node().id, field.key, $any(node())[field.key] ?? '', field.pinCap, $any(node()).anchorId)"
                  [ngModelOptions]="{ standalone: true }"
                  [name]="'grp-' + node().id + '-' + field.key"
                  (ngModelChange)="onTransportChange(node().id, field.key, $event, field.pinCap, $any(node()).anchorId)"
                  (blur)="pinCtrl.control.markAsTouched()">
                  <option value="">-- transport --</option>
                  @for (group of editor.channelGroupsForController($any(node()).anchorId ?? '', field.pinCap); track group.provider) {
                    <option [value]="group.provider">{{ group.label }}</option>
                  }
                </select>
                @if (activeGroupChannels(node().id, field.key, $any(node())[field.key] ?? '', field.pinCap, $any(node()).anchorId); as channels) {
                  @if (channels.length > 1) {
                    <select class="select select-xs select-bordered flex-1 font-mono min-w-0"
                      [name]="'ch-' + node().id + '-' + field.key"
                      [ngModelOptions]="{ standalone: true }"
                      [ngModel]="$any(node())[field.key]"
                      (ngModelChange)="updateField.emit({ nodeId: node().id, field: field.key, value: $event })"
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
                [schema]="desc().schema"
                [fieldKey]="field.key"
                type="number"
                inputClass="w-full font-mono"
                [placeholder]="field.placeholder"
                [min]="0"
                [value]="$any(node())[field.key]"
                (valueChange)="updateField.emit({ nodeId: node().id, field: field.key, value: $event })" />
            } @else if (field.type === 'select') {
              <select class="select select-xs select-bordered w-full font-mono"
                [name]="'sel-' + node().id + '-' + field.key"
                [ngModelOptions]="{ standalone: true }"
                [ngModel]="$any(node())[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: node().id, field: field.key, value: $event })">
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
                [name]="'tog-' + node().id + '-' + field.key"
                [ngModelOptions]="{ standalone: true }"
                [ngModel]="!!$any(node())[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: node().id, field: field.key, value: $event })" />
            } @else {
              <app-zod-input
                [schema]="desc().schema"
                [fieldKey]="field.key"
                inputClass="w-full font-mono"
                [policy]="field.inputPolicy"
                [placeholder]="field.placeholder"
                [value]="$any(node())[field.key]"
                (valueChange)="updateField.emit({ nodeId: node().id, field: field.key, value: $event })" />
            }
          </div>
          @if (field.hint) {
            <div class="sidebar-hint">{{ field.hint }}</div>
          }
          }
        }
      </div>

      <!-- Tank with intrinsic pressure sensor: derived calibration readout. -->
      @if (node().kind === 'tank') {
        @if (tankPressureReadout(node()); as r) {
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
                Enter tank height and sensor max to derive calibration.
              </div>
            }
          </div>
        }
      }

      <!-- Tank with intrinsic pressure sensor calibration readout -->
      @if (node().kind === 'tank' && $any(node()).level_monitored) {
        @if (pressureSensorReadout(node()); as r) {
          <div class="mt-3 pt-3 border-t border-base-300/30">
            <h4 class="sidebar-title">Sensor Range</h4>
            <div class="sidebar-fields">
              <span class="sidebar-label">Max rated</span>
              <span class="text-xs font-mono">{{ r.sensorMax }} psi</span>
            </div>
            <div class="text-[10px] text-base-content/50 mt-1">
              Tank-mounted pressure sensor calibration. Cal Empty / Cal Full are set from the dashboard.
            </div>
          </div>
        }
      }


      <!-- Remote imports — read-only info showing which controllers import this local node. -->
      @if (!isRemoteNode(node()) && nodeImporterNames(node().id).length > 0) {
        <div class="mt-3 pt-3 border-t border-base-300/30">
          <h4 class="sidebar-title">Imported By</h4>
          <div class="flex flex-wrap gap-1">
            @for (name of nodeImporterNames(node().id); track name) {
              <span class="badge badge-secondary badge-xs">{{ name }}</span>
            }
          </div>
          <div class="text-[10px] text-base-content/40 mt-1">
            Other controllers have imported this node as a remote reference.
          </div>
        </div>
      }

      @if (!desc().singleton) {
        <button class="btn btn-error btn-xs mt-3 w-full" (click)="deleteNode.emit(node().id)">Delete {{ desc().label }}</button>
      }
      }
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
      background: none; border: none; padding: 0; cursor: pointer;
    }
    .sidebar-title:hover { color: oklch(var(--bc) / 0.7); }
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
export class NodePropertiesComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);

  // --- Inputs / outputs ---
  node = input.required<TopologyNode>();
  desc = input.required<NodeDescriptor>();
  updateField = output<{ nodeId: string; field: string; value: any }>();
  deleteNode = output<string>();

  // --- Section collapse ---
  protected expanded = signal(true);
  protected toggleNode() { this.expanded.update((v) => !v); }

  protected isFieldVisible(field: FieldDef, node: Record<string, unknown>): boolean {
    if (!field.visibleWhen) return true;
    const value = node[field.visibleWhen.key];
    if ('eq' in field.visibleWhen) return value === field.visibleWhen.eq;
    if ('in' in field.visibleWhen) return (field.visibleWhen.in as ReadonlyArray<unknown>).includes(value as string);
    if ('neq' in field.visibleWhen) return value !== field.visibleWhen.neq;
    return true;
  }

  /** All controllers for the node assignment dropdown. */
  protected allControllers = computed(() => {
    const topology = this.workspace.siteTopology();
    return topology?.controllers.map(c => ({
      id: c.id,
      friendlyName: c.friendlyName ?? c.id,
    })) ?? [];
  });

  /** True when a node's anchorId differs from the active controller. */
  protected isRemoteNode(node: TopologyNode): boolean {
    return node.anchorId !== this.workspace.activeControllerId();
  }

  /** Friendly name of the controller that owns this node. */
  protected controllerNameFor(node: TopologyNode): string {
    const topology = this.workspace.siteTopology();
    const ctrl = topology?.controllers.find(c => c.id === node.anchorId);
    return ctrl?.friendlyName ?? node.anchorId;
  }

  /** Names of controllers that have imported this local node as remote. */
  protected nodeImporterNames(nodeId: string): string[] {
    const topology = this.workspace.siteTopology();
    if (!topology) return [];
    return topology.remoteImports
      .filter(ri => ri.nodeId === nodeId)
      .map(ri => {
        const ctrl = topology.controllers.find(c => c.id === ri.controllerId);
        return ctrl?.friendlyName ?? ri.controllerId;
      });
  }

  // --- Two-step channel selector helpers ---

  /** Tracks user's transport group selection per field (survives value clearing). */
  private selectedGroups = new Map<string, string>();

  /** Resolve active group: explicit selection > derived from value > empty.
   *  Uses the NODE'S controller so pin options stay correct even when the
   *  editor is focused on a different controller. */
  protected activeGroup(
    nodeId: string,
    fieldKey: string,
    currentValue: string,
    cap?: PinCap,
    nodeAnchorId: string = this.editor.controllerId() ?? '',
  ): string {
    const key = `${nodeId}:${fieldKey}`;
    const explicit = this.selectedGroups.get(key);
    if (explicit) return explicit;
    if (!currentValue) return '';
    const groups = this.editor.channelGroupsForController(nodeAnchorId, cap);
    for (const g of groups) {
      if (g.channels.some(ch => ch.id === currentValue)) return g.provider;
    }
    return '';
  }

  /** Channels in the active group for step 2. */
  protected activeGroupChannels(
    nodeId: string,
    fieldKey: string,
    currentValue: string,
    cap?: PinCap,
    nodeAnchorId: string = this.editor.controllerId() ?? '',
  ): Array<{ id: string; label: string; caps: PinCap[]; usedBy?: string }> {
    const groupId = this.activeGroup(nodeId, fieldKey, currentValue, cap, nodeAnchorId);
    if (!groupId) return [];
    const groups = this.editor.channelGroupsForController(nodeAnchorId, cap);
    const group = groups.find(g => g.provider === groupId);
    return group?.channels ?? [];
  }

  /** When transport group changes, auto-select if single channel or clear. */
  protected onTransportChange(
    nodeId: string,
    field: string,
    groupId: string,
    cap?: PinCap,
    nodeAnchorId: string = this.editor.controllerId() ?? '',
  ) {
    const key = `${nodeId}:${field}`;
    this.selectedGroups.set(key, groupId);
    if (!groupId) { this.updateField.emit({ nodeId, field, value: '' }); return; }
    const groups = this.editor.channelGroupsForController(nodeAnchorId, cap);
    const group = groups.find(g => g.provider === groupId);
    if (!group) { this.updateField.emit({ nodeId, field, value: '' }); return; }
    if (group.channels.length === 1) {
      this.updateField.emit({ nodeId, field, value: group.channels[0].id });
    } else {
      this.updateField.emit({ nodeId, field, value: '' });
    }
  }

  // --- Tank pressure derived readout ---

  /**
   * Compute the derived calibration panel for a tank node with an intrinsic
   * pressure sensor. Returns null when pressure_sensor_max_psi is missing.
   */
  protected tankPressureReadout(node: any): {
    cal: { p_empty_psi: number; p_full_psi: number; working_span_psi: number } | null;
    recommended: number;
    swingPct: number;
    headroomPct: number;
  } | null {
    const sensorMax = Number(node.pressure_sensor_max_psi);
    if (!Number.isFinite(sensorMax) || sensorMax <= 0) return null;
    const tankHeight = Number(node.height_m);
    if (!Number.isFinite(tankHeight) || tankHeight <= 0) {
      return { cal: null, recommended: 0, swingPct: 0, headroomPct: 0 };
    }
    const elevation = Number(node.pressure_elevation_m ?? 0);
    const cal = deriveTankCalibration(tankHeight, Number.isFinite(elevation) ? elevation : 0);
    return {
      cal,
      recommended: recommendSensorMaxPsi(cal.p_full_psi),
      swingPct: (cal.working_span_psi / sensorMax) * 100,
      headroomPct: ((sensorMax - cal.p_full_psi) / sensorMax) * 100,
    };
  }

  // --- Inline pressure-sensor readout ---

  /**
   * Minimal readout for inline pressure sensors. In the new model they never
   * have upstream tank calibration context, so we only show the sensor range.
   */
  protected pressureSensorReadout(node: any): {
    sensorMax: number;
  } | null {
    const sensorMax = Number(node.pressure_sensor_max_psi);
    if (!Number.isFinite(sensorMax) || sensorMax <= 0) return null;
    return { sensorMax };
  }
}
