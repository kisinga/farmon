import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { CONTROLLER_COLORS } from '../../../shared/canvas/topology-overlays';

/**
 * Site overview panel — the controllers roster and derived routes for the whole
 * site. Lives inside the workspace (not a separate page); selecting a controller
 * focuses it on the shared canvas rather than navigating away.
 */
@Component({
  selector: 'app-site-panel',
  standalone: true,
  host: { class: 'flex-1 flex min-h-0 overflow-hidden' },
  template: `
    <!-- Controllers roster -->
    <div class="w-72 shrink-0 bg-base-100 border-r border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20 flex items-center">
        <span class="flex-1">Controllers</span>
        <span class="text-base-content/30">{{ systemEntries().length }}</span>
      </div>
      <div class="flex-1 overflow-auto">
        @for (entry of systemEntries(); track entry.id) {
          <div
            class="w-full text-left px-3 py-2 text-sm hover:bg-base-200/60 transition-colors border-b border-base-300/10 group flex items-center cursor-pointer"
            [class.bg-base-200/50]="entry.id === workspace.activeControllerId()"
            (click)="focus(entry.id)"
          >
            <div class="w-2.5 h-2.5 rounded-full shrink-0 mr-2" [style.backgroundColor]="entry.color"></div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-medium truncate">{{ entry.friendlyName }}</span>
                @if (workspace.dirtyControllerIds().has(entry.id)) {
                  <span class="badge badge-warning badge-xs shrink-0" title="Unsaved changes">modified</span>
                }
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-base-content/40 font-mono">{{ entry.board }}</span>
                <span class="text-[10px] text-base-content/30">{{ entry.nodeCount }} nodes</span>
              </div>
            </div>
            <button
              class="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1"
              (click)="deleteSystem(entry.id, entry.friendlyName, $event)"
              title="Delete controller"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        }
        @if (systemEntries().length === 0) {
          <div class="px-3 py-6 text-xs text-base-content/30 text-center">
            No controllers yet. Use “Add Controller” in the Design canvas.
          </div>
        }
      </div>
    </div>

    <!-- Routes grouped by controller -->
    <div class="flex-1 min-w-0 bg-base-100 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">
        Routes ({{ workspace.siteRoutes().length }})
      </div>
      <div class="flex-1 overflow-auto">
        @for (group of routeGroups(); track group.controllerId) {
          <div class="px-3 py-1.5 flex items-center gap-2 border-b border-base-300/20 sticky top-0 bg-base-100 z-10">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" [style.backgroundColor]="group.color"></div>
            <span class="text-[11px] font-semibold truncate" [style.color]="group.color">{{ group.friendlyName }}</span>
            <span class="text-[10px] text-base-content/30 ml-auto">{{ group.routes.length }}</span>
          </div>
          @for (route of group.routes; track route.key) {
            <div class="pl-6 pr-3 py-1.5 text-xs border-b border-base-300/10 hover:bg-base-200/40 transition-colors"
                 [style.borderLeftColor]="group.color"
                 style="border-left-width: 2px;">
              <div class="font-mono text-[11px] leading-snug break-all" [style.color]="group.color">
                {{ route.displaySource }}
                <span class="text-base-content/30">&rsaquo;</span>
                {{ route.displayDest }}
              </div>
              @if (route.crossController) {
                <div class="text-[10px] text-base-content/30 italic">via {{ route.destController }}</div>
              }
              <div class="flex items-center gap-2 mt-0.5 text-[10px] text-base-content/40">
                <span>{{ route.valveCount }} valve{{ route.valveCount !== 1 ? 's' : '' }}</span>
                @if (route.hasPump) { <span class="badge badge-ghost badge-xs">pump</span> }
                @if (!route.monitored) { <span class="badge badge-ghost badge-xs">unmonitored</span> }
              </div>
            </div>
          }
        }
        @if (workspace.siteRoutes().length === 0) {
          <div class="px-3 py-6 text-xs text-base-content/30 text-center">No routes derived yet.</div>
        }
      </div>
    </div>
  `,
})
export class SitePanelComponent {
  protected workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private confirmService = inject(ConfirmService);
  private router = inject(Router);

  /** Controllers with stable colors, board + node counts. */
  protected systemEntries = computed(() => {
    const topology = this.workspace.siteTopology();
    return (topology?.controllers ?? []).map((ctrl, i) => ({
      id: ctrl.id,
      friendlyName: ctrl.friendlyName ?? ctrl.id,
      board: ctrl.board,
      color: CONTROLLER_COLORS[i % CONTROLLER_COLORS.length],
      nodeCount: topology?.nodes.filter(n => n.anchorId === ctrl.id).length ?? 0,
    }));
  });

  /** Routes grouped by source controller, with boundary colors and clean names. */
  protected routeGroups = computed(() => {
    const routes = this.workspace.siteRoutes();
    const topology = this.workspace.siteTopology();
    if (!topology) return [];

    const controllerIds = topology.controllers.map(c => c.id);
    const controllerColor = new Map<string, string>();
    const controllerFriendly = new Map<string, string>();
    controllerIds.forEach((id, i) => {
      controllerColor.set(id, CONTROLLER_COLORS[i % CONTROLLER_COLORS.length]);
      controllerFriendly.set(id, topology.controllers.find(c => c.id === id)?.friendlyName ?? id);
    });

    const groups = new Map<string, Array<{
      key: string; displaySource: string; displayDest: string;
      crossController: boolean; destController: string;
      valveCount: number; hasPump: boolean; monitored: boolean;
    }>>();

    for (const route of routes) {
      const srcNode = topology.nodes.find(n => n.id === route.source);
      const destNode = topology.nodes.find(n => n.id === route.destination);
      const srcController = srcNode?.anchorId ?? 'unknown';
      const destController = destNode?.anchorId ?? 'unknown';

      const arr = groups.get(srcController) ?? [];
      arr.push({
        key: route.key,
        displaySource: route.source,
        displayDest: route.destination,
        crossController: srcController !== destController,
        destController: controllerFriendly.get(destController) ?? destController,
        valveCount: route.valves.length,
        hasPump: route.crossesPump,
        monitored: route.monitored,
      });
      groups.set(srcController, arr);
    }

    return controllerIds
      .filter(id => groups.has(id))
      .map(id => ({
        controllerId: id,
        friendlyName: controllerFriendly.get(id) ?? id,
        color: controllerColor.get(id) ?? '#666',
        routes: groups.get(id)!,
      }));
  });

  /** Focus a controller on the shared canvas and jump to the Design view. */
  protected focus(controllerId: string) {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;
    this.editor.panel.set('design');
    this.router.navigate(['/site', siteId, 'system', controllerId]);
  }

  protected async deleteSystem(systemId: string, friendlyName: string, event: Event) {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Controller',
      message: `Delete "${friendlyName}"? All pipes to/from this controller will also be removed.`,
    });
    if (!confirmed) return;
    if (this.workspace.activeControllerId() === systemId) {
      this.workspace.unfocusController();
    }
    await this.workspace.removeController(systemId);
  }
}
