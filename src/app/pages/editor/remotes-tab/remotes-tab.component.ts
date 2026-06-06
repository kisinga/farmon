import { Component, inject, computed } from '@angular/core';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { NODE_REGISTRY, legendSvgFor, buildGraph, activeGraph, deriveRoutes, controllerClaimsSegment } from '@core';
import type { TopologyNode } from '../../../core/models/topology.model';
import { SectionHeaderComponent } from '../shared/section-header.component';

@Component({
  selector: 'app-remotes-tab',
  standalone: true,
  imports: [SectionHeaderComponent],
  template: `
    @if (editor.topology(); as t) {
      <div class="content-pane space-y-6">
        <app-section-header
          title="Sharing"
          subtitle="Let this controller read sensors from, and drive actuators on, another controller. Controllers coordinate directly over your local network." />

        <div class="alert alert-info text-xs items-start">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span>Controllers coordinate directly over your <strong>local network</strong>, so the ones that share must be on the same LAN. This works whether the site runs on MajiFlow Cloud or your own server.</span>
        </div>

        <!-- Section 1: Import Remote Nodes -->
        <div>
          <h2 class="text-base font-semibold">Import remote nodes</h2>
          <p class="text-xs text-base-content/50 mt-0.5">
            Pick nodes on other controllers to import as remote references. They show up in route
            tables and monitoring.
          </p>
        </div>

        @if (groupedRemoteNodes().length === 0) {
          <div class="surface px-6 py-10 text-center">
            <p class="text-sm text-base-content/50">No remote nodes available.</p>
            <p class="text-xs text-base-content/40 mt-1">Add controllers and nodes in Design first.</p>
          </div>
        } @else {
          @for (group of groupedRemoteNodes(); track group.controllerId) {
            <div class="card surface">
              <div class="card-body gap-3">
                <h3 class="font-semibold text-sm text-base-content/60 uppercase tracking-wider">
                  {{ group.controllerName }}
                </h3>
                <div class="divide-y divide-base-300/30">
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
          <h2 class="text-base font-semibold">Shared with other controllers</h2>
          <p class="text-xs text-base-content/50 mt-0.5">
            Nodes physically on this controller that other controllers have imported.
          </p>
        </div>

        @if (localNodesImportedByOthers().length === 0) {
          <div class="surface px-6 py-10 text-center">
            <p class="text-sm text-base-content/50">No other controller imports nodes from this one yet.</p>
          </div>
        } @else {
          <div class="card surface">
            <div class="card-body gap-3">
              <div class="divide-y divide-base-300/30">
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

  protected activeControllerId = computed(() => this.workspace.activeControllerId());
  private siteTopology = computed(() => this.workspace.siteTopology());

  /** All routes derived from the full site topology. */
  private allRoutes = computed(() => {
    const topology = this.siteTopology();
    if (!topology) return [];
    const graph = buildGraph(topology.nodes, topology.pipes);
    return deriveRoutes(activeGraph(graph));
  });

  /** Routes claimed by the active controller. */
  private activeControllerRoutes = computed(() => {
    const topology = this.siteTopology();
    const cid = this.activeControllerId();
    if (!topology || !cid) return [];
    return this.allRoutes().filter(r => controllerClaimsSegment(r, cid, topology));
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
