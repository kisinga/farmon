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

        <!-- Interconnect site link section -->
        @if (sn.node.kind === 'interconnect') {
          <div class="mt-3 pt-3 border-t border-base-300/30">
            <h4 class="sidebar-title">Site Link</h4>

            <!-- Existing links -->
            @for (hl of interconnectLinks(); track hl.link.id) {
              <div class="flex items-center gap-2 py-1 text-xs">
                <span class="badge badge-xs" [class.badge-info]="hl.direction === 'outgoing'" [class.badge-success]="hl.direction === 'incoming'">
                  {{ hl.direction === 'outgoing' ? '\u2192' : '\u2190' }}
                </span>
                <span class="font-medium truncate flex-1">{{ hl.remoteName }}</span>
                <button class="btn btn-ghost btn-xs text-error" (click)="unlinkInterconnect(hl.link.id)" title="Remove link">\u00d7</button>
              </div>
            }

            @if (linkDirection()) {
              @if (otherSystems().length === 0) {
                <div class="text-xs text-warning py-2">Add another controller to this site before linking this interconnect.</div>
              } @else {
                <div class="space-y-2">
                  <div class="text-[10px] text-base-content/40 mb-1">
                    {{ linkDirection() === 'outgoing' ? 'Link to (outlet \u2192 inlet)' : 'Link from (outlet \u2192 inlet)' }}
                  </div>
                  <select class="select select-xs select-bordered w-full"
                    [ngModel]="linkTargetSystem()"
                    (ngModelChange)="linkTargetSystem.set($event); linkTargetPort.set(null)">
                    <option [ngValue]="null">Select target controller...</option>
                    @for (sys of otherSystems(); track sys.config) {
                      <option [ngValue]="sys.config">{{ sys.friendlyName }}</option>
                    }
                  </select>

                  @if (linkTargetSystem()) {
                    @if (targetBoundaryPorts().length === 0) {
                      <div class="space-y-2">
                        <div class="text-xs text-base-content/50">No interconnects in target controller.</div>
                        <button class="btn btn-xs btn-outline btn-primary w-full" (click)="createInterconnectInTarget()">
                          + Create Interconnect
                        </button>
                      </div>
                    } @else {
                      <select class="select select-xs select-bordered w-full"
                        [ngModel]="linkTargetPort()"
                        (ngModelChange)="linkTargetPort.set($event)">
                        <option [ngValue]="null">Select target port...</option>
                        @for (port of targetBoundaryPorts(); track port.nodeId + ':' + port.portId) {
                          <option [ngValue]="port.nodeId + ':' + port.portId">
                            {{ port.nodeName }} ({{ port.portId }})
                          </option>
                        }
                      </select>
                      @if (linkTargetPort()) {
                        <button class="btn btn-xs btn-primary w-full" (click)="createInterconnectLink()">Create Link</button>
                      }
                    }
                  }
                </div>
              }
            }
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
                  <label class="text-[10px] text-base-content/50">Max Runtime</label>
                  <app-zod-input
                    [schema]="routeOverrideSchema"
                    fieldKey="max_runtime_seconds"
                    type="number"
                    inputClass="w-20 font-mono"
                    [min]="0"
                    [step]="60"
                    [value]="entry.override.max_runtime_seconds ?? 1800"
                    (valueChange)="updateRouteOverride.emit({ key: entry.key, field: 'max_runtime_seconds', value: $any($event) })" />
                  <span class="text-[10px] text-base-content/50">s</span>
                </div>
                @if (entry.sourceHasLevel) {
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-base-content/50">Source Min</label>
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
                    <label class="text-[10px] text-base-content/50">Dest Max</label>
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

  // --- Interconnect link form state ---
  protected linkTargetSystem = signal<string | null>(null);
  protected linkTargetPort = signal<string | null>(null);

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

  /** Links involving the currently selected interconnect node */
  protected interconnectLinks = computed(() => {
    const sn = this.selectedNodeData();
    if (!sn || sn.node.kind !== 'interconnect') return [];
    const systemId = this.workspace.activeSystemId();
    const links = this.workspace.links();
    if (!systemId) return [];

    const nodeId = sn.node.id;
    return links.filter(link =>
      (link.fromSystem === systemId && link.fromNode === nodeId)
      || (link.toSystem === systemId && link.toNode === nodeId)
    ).map(link => {
      const isSource = link.fromSystem === systemId && link.fromNode === nodeId;
      const remoteSystemId = isSource ? link.toSystem : link.fromSystem;
      const remoteNodeId = isSource ? link.toNode : link.fromNode;
      const remotePortId = isSource ? link.toPort : link.fromPort;
      const remoteSystem = this.workspace.systems().get(remoteSystemId);
      const remoteName = remoteSystem?.topology.device.friendly_name ?? remoteSystemId;
      return { link, remoteName, remoteNodeId, remotePortId, direction: isSource ? 'outgoing' : 'incoming' as const };
    });
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

  /** Whether the current interconnect links as outgoing (outlet→inlet) or incoming (inlet←outlet). */
  protected linkDirection = computed<'outgoing' | 'incoming' | null>(() => {
    const sn = this.selectedNodeData();
    const systemId = this.workspace.activeSystemId();
    const links = this.workspace.links();
    if (!sn || sn.node.kind !== 'interconnect' || !systemId) return null;
    const outUsed = links.some(l => l.fromSystem === systemId && l.fromNode === sn.node.id);
    const inUsed = links.some(l => l.toSystem === systemId && l.toNode === sn.node.id);
    if (!outUsed) return 'outgoing';
    if (!inUsed) return 'incoming';
    return null; // both ports linked
  });

  /** Boundary ports on the target system, filtered by link direction. */
  protected targetBoundaryPorts = computed(() => {
    const target = this.linkTargetSystem();
    const dir = this.linkDirection();
    if (!target || !dir) return [];
    const all = this.workspace.boundaryPortsBySystem().get(target) ?? [];
    // Outgoing: current outlet → target inlet. Incoming: target outlet → current inlet.
    const wantDir = dir === 'outgoing' ? 'inlet' : 'outlet';
    return all.filter(p => p.nodeKind === 'interconnect' && p.direction === wantDir);
  });

  // --- Interconnect link actions ---

  protected createInterconnectLink() {
    const sn = this.selectedNodeData();
    const systemId = this.workspace.activeSystemId();
    const targetSystem = this.linkTargetSystem();
    const targetPort = this.linkTargetPort();
    const dir = this.linkDirection();
    if (!sn || !systemId || !targetSystem || !targetPort || !dir) return;

    const [targetNodeId, targetPortId] = targetPort.split(':');

    if (dir === 'outgoing') {
      // Current outlet → target inlet
      const outletPort = sn.node.ports.find(p => p.direction === 'outlet');
      this.workspace.addLink({
        id: crypto.randomUUID(),
        fromSystem: systemId,
        fromNode: sn.node.id,
        fromPort: outletPort?.id ?? 'outlet',
        toSystem: targetSystem,
        toNode: targetNodeId,
        toPort: targetPortId,
      });
    } else {
      // Target outlet → current inlet
      const inletPort = sn.node.ports.find(p => p.direction === 'inlet');
      this.workspace.addLink({
        id: crypto.randomUUID(),
        fromSystem: targetSystem,
        fromNode: targetNodeId,
        fromPort: targetPortId,
        toSystem: systemId,
        toNode: sn.node.id,
        toPort: inletPort?.id ?? 'inlet',
      });
    }

    this.linkTargetSystem.set(null);
    this.linkTargetPort.set(null);
  }

  /** Create an interconnect node in the target system without switching to it. */
  protected createInterconnectInTarget() {
    const targetSystemId = this.linkTargetSystem();
    if (!targetSystemId) return;

    const kind = 'interconnect';
    const id = this.workspace.nextNodeId(kind);
    const n = this.workspace.systems().get(targetSystemId)?.topology.nodes.filter(n => n.kind === kind).length ?? 0;

    this.workspace.updateSystemTopology(targetSystemId, t => {
      // Place below existing nodes so it doesn't overlap
      let maxY = 0;
      for (const node of t.nodes) {
        maxY = Math.max(maxY, node.position.y + 60);
      }
      t.nodes.push({
        kind,
        id,
        name: `Interconnect ${n + 1}`,
        ports: [
          { id: 'inlet', label: 'Inlet', direction: 'inlet' },
          { id: 'outlet', label: 'Outlet', direction: 'outlet' },
        ],
        position: { x: 0, y: maxY + 20 },
      } as any);
    });

    // Reset target port so the dropdown refreshes with the new interconnect
    this.linkTargetPort.set(null);
  }

  protected unlinkInterconnect(linkId: string) {
    this.workspace.removeLink(linkId);
  }

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
   * Find the `height_m` of the first tank one graph-hop upstream of `nodeId`.
   * Returns `undefined` if no upstream tank is connected or no height is set.
   */
  private upstreamTankHeight(nodeId: string): number | undefined {
    const t = this.editor.topology();
    if (!t) return undefined;
    for (const pipe of t.pipes) {
      const toId = pipe.to.split(':')[0];
      if (toId !== nodeId) continue;
      const fromId = pipe.from.split(':')[0];
      const upstream = t.nodes.find(n => n.id === fromId);
      if (upstream && upstream.kind === 'tank') {
        const h = (upstream as { height_m?: number }).height_m;
        return typeof h === 'number' ? h : undefined;
      }
    }
    return undefined;
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
