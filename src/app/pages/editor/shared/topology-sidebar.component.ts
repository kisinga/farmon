import { Component, inject, input, output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ValidationPanelComponent } from '../../../shared/validation-panel/validation-panel.component';
import type { RuleDiagnostic } from '../../../core/models/electron-api';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import type { DerivedRoute } from './derive-routes';
import { buildGraph, activeGraph, deriveRoutes } from '@far-mon/core';
import type { Selection } from './selection';
export type { Selection };

@Component({
  selector: 'app-topology-sidebar',
  standalone: true,
  imports: [FormsModule, ValidationPanelComponent],
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
          <input class="input input-xs input-bordered w-full font-mono"
            [ngModel]="$any(sn.node).name"
            (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: 'name', value: $event })" />
          <label class="sidebar-label">ID</label>
          <input class="input input-xs input-bordered w-full font-mono text-base-content/50"
            [ngModel]="sn.node.id" readonly />
          <label class="sidebar-label">Enabled</label>
          <input type="checkbox" class="toggle toggle-xs toggle-success"
            [ngModel]="!$any(sn.node).disabled"
            (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: 'disabled', value: !$event })" />
          <!-- Entity-specific fields -->
          @for (field of sn.desc.sidebarFields; track field.key) {
            <label class="sidebar-label">{{ field.label }}</label>
            @if (field.type === 'pin') {
              <select class="select select-xs select-bordered flex-1 font-mono"
                [class.select-warning]="!$any(sn.node)[field.key]"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })">
                <option value="">-- select --</option>
                @for (pin of editor.availablePins(field.pinCap); track pin.gpio) {
                  <option [value]="pin.gpio" [disabled]="!!pin.usedBy">
                    {{ pin.gpio }} [{{ pin.caps.join(', ') }}]{{ pin.usedBy ? ' (' + pin.usedBy + ')' : '' }}
                  </option>
                }
              </select>
            } @else if (field.type === 'number') {
              <input type="number" class="input input-xs input-bordered w-full font-mono"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: +$event })" min="0" />
            } @else {
              <input class="input input-xs input-bordered w-full font-mono"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })" />
            }
          }
        </div>

        <!-- Handoff site link section -->
        @if (sn.node.kind === 'handoff') {
          <div class="mt-3 pt-3 border-t border-base-300/30">
            <h4 class="sidebar-title">Site Link</h4>

            <!-- Existing links -->
            @for (hl of handoffLinks(); track hl.link.id) {
              <div class="flex items-center gap-2 py-1 text-xs">
                <span class="badge badge-xs" [class.badge-info]="hl.direction === 'outgoing'" [class.badge-success]="hl.direction === 'incoming'">
                  {{ hl.direction === 'outgoing' ? '\u2192' : '\u2190' }}
                </span>
                <span class="font-medium truncate flex-1">{{ hl.remoteName }}</span>
                <button class="btn btn-ghost btn-xs text-error" (click)="unlinkHandoff(hl.link.id)" title="Remove link">\u00d7</button>
              </div>
            }

            @if (handoffLinks().length === 0) {
              @if (otherSystems().length === 0) {
                <div class="text-xs text-warning py-2">Add another system to this site before linking this handoff.</div>
              } @else {
                <div class="space-y-2">
                  <select class="select select-xs select-bordered w-full"
                    [ngModel]="linkTargetSystem()"
                    (ngModelChange)="linkTargetSystem.set($event); linkTargetPort.set(null)">
                    <option [ngValue]="null">Select target system...</option>
                    @for (sys of otherSystems(); track sys.config) {
                      <option [ngValue]="sys.config">{{ sys.friendlyName }}</option>
                    }
                  </select>

                  @if (linkTargetSystem()) {
                    @if (targetBoundaryPorts().length === 0) {
                      <div class="text-xs text-warning">Target system has no available boundary ports. Add a handoff node to that system first.</div>
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
                        <button class="btn btn-xs btn-primary w-full" (click)="createHandoffLink()">Create Link</button>
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
                  <input type="number" class="input input-xs input-bordered w-20 font-mono"
                    [ngModel]="entry.override.max_runtime_seconds ?? 1800"
                    (ngModelChange)="updateMaxRuntime.emit({ key: entry.key, value: $event })" min="0" step="60" />
                  <span class="text-[10px] text-base-content/50">s</span>
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
    .sidebar-fields { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; }
    .sidebar-label { font-size: 10px; color: oklch(var(--bc) / 0.5); white-space: nowrap; }
  `],
})
export class TopologySidebarComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);

  // --- Inputs ---
  selection = input<Selection | null>(null);

  // --- Outputs ---
  deleteNode = output<string>();
  deletePipe = output<string>();
  updateField = output<{ nodeId: string; field: string; value: any }>();
  updateMaxRuntime = output<{ key: string; value: number }>();
  selectRoute = output<{ route: DerivedRoute; sharedNodeIds?: string[] }>();
  selectNode = output<string>();

  // --- Handoff link form state ---
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
    return Object.entries(t.route_overrides ?? {}).map(([key, override]) => ({ key, override }));
  });

  /** Links involving the currently selected handoff node */
  protected handoffLinks = computed(() => {
    const sn = this.selectedNodeData();
    if (!sn || sn.node.kind !== 'handoff') return [];
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

  /** Boundary ports on the selected target system */
  protected targetBoundaryPorts = computed(() => {
    const target = this.linkTargetSystem();
    if (!target) return [];
    return this.workspace.boundaryPortsBySystem().get(target) ?? [];
  });

  // --- Handoff link actions ---

  protected createHandoffLink() {
    const sn = this.selectedNodeData();
    const systemId = this.workspace.activeSystemId();
    const targetSystem = this.linkTargetSystem();
    const targetPort = this.linkTargetPort();
    if (!sn || !systemId || !targetSystem || !targetPort) return;

    const handoffOutlet = sn.node.ports.find(p => p.direction === 'outlet');
    const [targetNodeId, targetPortId] = targetPort.split(':');

    this.workspace.addLink({
      id: crypto.randomUUID(),
      fromSystem: systemId,
      fromNode: sn.node.id,
      fromPort: handoffOutlet?.id ?? 'outlet',
      toSystem: targetSystem,
      toNode: targetNodeId,
      toPort: targetPortId,
    });

    this.linkTargetSystem.set(null);
    this.linkTargetPort.set(null);
  }

  protected unlinkHandoff(linkId: string) {
    this.workspace.removeLink(linkId);
  }

  // --- Helpers ---
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
