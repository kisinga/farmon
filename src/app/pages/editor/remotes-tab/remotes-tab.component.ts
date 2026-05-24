import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { NODE_REGISTRY, legendSvgFor, buildGraph, activeGraph, deriveRoutes } from '@far-mon/core';
import type { TopologyNode } from '../../../core/models/topology.model';

@Component({
  selector: 'app-remotes-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology(); as t) {
      <div class="content-pane space-y-6">

        <!-- Controller selector -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body p-4 flex flex-row items-center gap-4">
            <span class="text-sm font-medium text-base-content/70">Controller</span>
            <select class="select select-sm select-bordered flex-1 font-mono"
              [ngModel]="activeControllerId()"
              (ngModelChange)="switchController($event)">
              @for (ctrl of allControllers(); track ctrl.id) {
                <option [value]="ctrl.id">{{ ctrl.friendlyName }}</option>
              }
            </select>
          </div>
        </div>

        <!-- Section 1: Import Remote Nodes -->
        <div>
          <h2 class="text-lg font-semibold">Import Remote Nodes</h2>
          <p class="text-sm text-base-content/50 mt-1">
            Select nodes from other controllers that this controller imports as remote references.
            Imported nodes appear in the manifest for route tables and monitoring.
          </p>
        </div>

        @if (groupedRemoteNodes().length === 0) {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body p-6 text-center">
              <p class="text-sm text-base-content/50">No remote nodes available.</p>
              <p class="text-xs text-base-content/40 mt-1">Add controllers and nodes in the Design tab first.</p>
            </div>
          </div>
        } @else {
          @for (group of groupedRemoteNodes(); track group.controllerId) {
            <div class="card bg-base-100 shadow-sm border border-base-200">
              <div class="card-body gap-3">
                <h3 class="font-semibold text-sm text-base-content/60 uppercase tracking-wider">
                  {{ group.controllerName }}
                </h3>
                <div class="divide-y divide-base-200">
                  @for (node of group.nodes; track node.id) {
                    <div class="flex items-center gap-3 py-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm checkbox-primary"
                        [checked]="isImported(node.id)"
                        (change)="toggleImport(node.id, $any($event.target).checked)"
                      />
                      <span class="shrink-0" [innerHTML]="legendSvg(node)"></span>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium truncate">{{ node.name || node.id }}</div>
                        <div class="text-xs text-base-content/50 font-mono">{{ node.id }}</div>
                      </div>
                      @if (routeDependencyCount(node.id) > 0) {
                        <span class="badge badge-info badge-xs">
                          needed by {{ routeDependencyCount(node.id) }} route{{ routeDependencyCount(node.id) !== 1 ? 's' : '' }}
                        </span>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
          }
        }

        <!-- Section 2: Local Nodes Imported by Others -->
        <div>
          <h2 class="text-lg font-semibold">Local Nodes Imported by Others</h2>
          <p class="text-sm text-base-content/50 mt-1">
            Nodes physically on this controller that other controllers have chosen to import.
          </p>
        </div>

        @if (localNodesImportedByOthers().length === 0) {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body p-6 text-center">
              <p class="text-sm text-base-content/50">No other controller imports nodes from this one yet.</p>
            </div>
          </div>
        } @else {
          <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body gap-3">
              <div class="divide-y divide-base-200">
                @for (entry of localNodesImportedByOthers(); track entry.node.id) {
                  <div class="flex items-center gap-3 py-3">
                    <span class="shrink-0" [innerHTML]="legendSvg(entry.node)"></span>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate">{{ entry.node.name || entry.node.id }}</div>
                      <div class="text-xs text-base-content/50 font-mono">{{ entry.node.id }}</div>
                    </div>
                    <div class="flex gap-1 flex-wrap justify-end">
                      @for (name of entry.consumerNames; track name) {
                        <span class="badge badge-secondary badge-xs">{{ name }}</span>
                      }
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
export class RemotesTabComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
  private router = inject(Router);

  protected activeControllerId = computed(() => this.workspace.activeControllerId());
  private siteTopology = computed(() => this.workspace.siteTopology());

  protected allControllers = computed(() => {
    const topology = this.siteTopology();
    return topology?.controllers.map(c => ({
      id: c.id,
      friendlyName: c.friendlyName ?? c.id,
    })) ?? [];
  });

  protected switchController(controllerId: string): void {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;
    this.router.navigate(['/site', siteId, 'system', controllerId, 'remotes']);
  }

  /** All routes derived from the full site topology. */
  private allRoutes = computed(() => {
    const topology = this.siteTopology();
    if (!topology) return [];
    const graph = buildGraph(topology.nodes, topology.pipes);
    return deriveRoutes(activeGraph(graph));
  });

  /** Routes owned by the active controller. */
  private activeControllerRoutes = computed(() => {
    const topology = this.siteTopology();
    const cid = this.activeControllerId();
    if (!topology || !cid) return [];
    return this.allRoutes().filter(r => {
      if (!r.valid) return false;
      const flowNode = topology.nodes.find(n => n.id === r.flowSensors[0]);
      return flowNode && flowNode.anchorId === cid;
    });
  });

  /** Map: nodeId → how many active-controller routes reference it. */
  protected routeDependencyCount = (nodeId: string): number => {
    return this.activeControllerRoutes().filter(r => r.nodeSequence.includes(nodeId)).length;
  };

  /** Nodes from other controllers, grouped by host controller. */
  protected groupedRemoteNodes = computed(() => {
    const topology = this.siteTopology();
    const cid = this.activeControllerId();
    if (!topology || !cid) return [];

    const groups = new Map<string, { controllerId: string; controllerName: string; nodes: TopologyNode[] }>();
    for (const node of topology.nodes) {
      if (node.anchorId === cid) continue;
      const ctrl = topology.controllers.find(c => c.id === node.anchorId);
      const key = ctrl?.id ?? node.anchorId;
      const existing = groups.get(key);
      if (existing) {
        existing.nodes.push(node);
      } else {
        groups.set(key, {
          controllerId: key,
          controllerName: ctrl?.friendlyName ?? key,
          nodes: [node],
        });
      }
    }
    return [...groups.values()].sort((a, b) => a.controllerName.localeCompare(b.controllerName));
  });

  /** Local nodes on this controller that are imported by at least one other controller. */
  protected localNodesImportedByOthers = computed(() => {
    const topology = this.siteTopology();
    const cid = this.activeControllerId();
    if (!topology || !cid) return [];

    const result: Array<{ node: TopologyNode; consumerNames: string[] }> = [];
    for (const node of topology.nodes) {
      if (node.anchorId !== cid) continue;
      const consumers = topology.remoteImports
        .filter(ri => ri.nodeId === node.id)
        .map(ri => {
          const ctrl = topology.controllers.find(c => c.id === ri.controllerId);
          return ctrl?.friendlyName ?? ri.controllerId;
        });
      if (consumers.length > 0) {
        result.push({ node, consumerNames: consumers });
      }
    }
    return result;
  });

  protected isImported(nodeId: string): boolean {
    const topology = this.siteTopology();
    const cid = this.activeControllerId();
    if (!topology || !cid) return false;
    return topology.remoteImports.some(ri => ri.controllerId === cid && ri.nodeId === nodeId);
  }

  protected toggleImport(nodeId: string, imported: boolean): void {
    const cid = this.activeControllerId();
    if (!cid) return;

    this.editor.updateTopology(t => {
      if (!t.remoteImports) t.remoteImports = [];
      if (imported) {
        const exists = t.remoteImports.some(ri => ri.controllerId === cid && ri.nodeId === nodeId);
        if (!exists) {
          t.remoteImports.push({ controllerId: cid, nodeId });
        }
      } else {
        t.remoteImports = t.remoteImports.filter(ri => !(ri.controllerId === cid && ri.nodeId === nodeId));
      }
    });
  }

  protected legendSvg(node: TopologyNode): string {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) return '';
    return legendSvgFor(desc);
  }
}
