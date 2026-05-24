import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewInit, NgZone, Injector, effect,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import { BOUNDARY_COLORS } from '../../shared/canvas/boundary-renderer';
import { renderCompositeOverlays } from '../../shared/canvas/topology-overlays';

@Component({
  selector: 'app-site-view',
  standalone: true,
  host: { class: 'flex-1 flex overflow-hidden' },
  template: `
    <!-- Left pane: controller list -->
    <div class="w-56 shrink-0 bg-base-100 border-r border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">Controllers</div>
      <div class="flex-1 overflow-auto">
        @for (entry of systemEntries(); track entry.id) {
          <div
            class="w-full text-left px-3 py-2 text-sm hover:bg-base-200/60 transition-colors border-b border-base-300/10 group flex items-center cursor-pointer"
            (click)="navigateToSystem(entry.id)"
          >
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
            No controllers yet. Click "Add Controller" above.
          </div>
        }
      </div>
    </div>

    <!-- Center: canvas -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 px-4 py-2 bg-base-100 border-b border-base-300/50 shrink-0">
        <span class="text-xs text-base-content/50 flex-1">Site topology</span>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomIn()" title="Zoom in">+</button>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomOut()" title="Zoom out">&minus;</button>
        <button class="btn btn-ghost btn-xs" (click)="fit()" title="Fit content">Fit</button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden" #canvasWrap>
        <div #canvasEl class="w-full h-full"></div>
      </div>
    </div>

    <!-- Right pane: derived routes grouped by controller -->
    <div class="w-72 shrink-0 bg-base-100 border-l border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">
        Routes ({{ workspace.siteRoutes().length }})
      </div>
      <div class="flex-1 overflow-auto">
        @for (group of routeGroups(); track group.controllerId) {
          <!-- Controller group header -->
          <div class="px-3 py-1.5 flex items-center gap-2 border-b border-base-300/20 sticky top-0 bg-base-100 z-10">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" [style.backgroundColor]="group.color"></div>
            <span class="text-[11px] font-semibold truncate" [style.color]="group.color">{{ group.friendlyName }}</span>
            <span class="text-[10px] text-base-content/30 ml-auto">{{ group.routes.length }}</span>
          </div>
          <!-- Routes in this controller -->
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
                @if (route.hasPump) {
                  <span class="badge badge-ghost badge-xs">pump</span>
                }
                @if (!route.valid) {
                  <span class="badge badge-error badge-xs">no sensor</span>
                }
              </div>
            </div>
          }
        }
        @if (workspace.siteRoutes().length === 0) {
          <div class="px-3 py-6 text-xs text-base-content/30 text-center">
            No routes derived yet.
          </div>
        }
      </div>
    </div>
  `,
})
export class SiteViewComponent implements OnInit, AfterViewInit, OnDestroy {
  protected workspace = inject(WorkspaceService);
  private confirmService = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private injector = inject(Injector);

  @ViewChild('canvasEl') canvasElRef!: ElementRef<HTMLElement>;
  @ViewChild('canvasWrap') canvasWrapRef!: ElementRef<HTMLElement>;

  protected loading = signal(true);

  private canvas: X6Canvas | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private siteName: string | null = null;

  protected systemEntries = signal<Array<{ id: string; friendlyName: string; board: string; nodeCount: number }>>([]);

  /** Routes grouped by source controller, with boundary colors and clean display names. */
  protected routeGroups = computed(() => {
    const routes = this.workspace.siteRoutes();
    const topology = this.workspace.siteTopology();
    if (!topology) return [];

    // Build controller ID → color + friendly name map
    const controllerIds = topology.controllers.map(c => c.id);
    const controllerColor = new Map<string, string>();
    const controllerFriendly = new Map<string, string>();
    controllerIds.forEach((id, i) => {
      controllerColor.set(id, BOUNDARY_COLORS[i % BOUNDARY_COLORS.length]);
      controllerFriendly.set(id, topology.controllers.find(c => c.id === id)?.friendlyName ?? id);
    });

    // Group routes by source controller (using anchorId of source node)
    const groups = new Map<string, Array<{
      key: string; displaySource: string; displayDest: string;
      crossController: boolean; destController: string;
      valveCount: number; hasPump: boolean; valid: boolean;
    }>>();

    for (const route of routes) {
      const srcNode = topology.nodes.find(n => n.id === route.source);
      const destNode = topology.nodes.find(n => n.id === route.destination);
      const srcController = srcNode?.anchorId ?? 'unknown';
      const destController = destNode?.anchorId ?? 'unknown';

      const entry = {
        key: route.key,
        displaySource: route.source,
        displayDest: route.destination,
        crossController: srcController !== destController,
        destController: controllerFriendly.get(destController) ?? destController,
        valveCount: route.valves.length,
        hasPump: route.crossesPump,
        valid: route.valid,
      };

      const arr = groups.get(srcController) ?? [];
      arr.push(entry);
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

  async ngOnInit() {
    this.siteName = this.route.snapshot.paramMap.get('name');
    if (!this.siteName) { this.router.navigate(['/overview']); return; }
    await this.workspace.load(this.siteName);
    this.updateSystemEntries();
    this.loading.set(false);
  }

  ngAfterViewInit() {
    const checkAndInit = () => {
      if (!this.workspace.site() || !this.canvasElRef) {
        setTimeout(checkAndInit, 50);
        return;
      }
      this.initCanvas();
    };
    checkAndInit();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.canvas?.destroy();
  }

  private updateSystemEntries() {
    const topology = this.workspace.siteTopology();
    const entries = (topology?.controllers ?? []).map(ctrl => ({
      id: ctrl.id,
      friendlyName: ctrl.friendlyName ?? ctrl.id,
      board: ctrl.board,
      nodeCount: topology?.nodes.filter(n => n.anchorId === ctrl.id).length ?? 0,
    }));
    this.systemEntries.set(entries);
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
    this.workspace.removeController(systemId);
    this.updateSystemEntries();
  }

  protected navigateToSystem(systemId: string) {
    this.router.navigate(['/site', this.siteName, 'system', systemId]);
  }

  private initCanvas() {
    const canvasEl = this.canvasElRef.nativeElement;
    const canvasWrap = this.canvasWrapRef.nativeElement;

    const noopEvents: CanvasEvents = {
      onNodesMoved: () => {},
      onPipeCreated: () => {},
      onPipeDeleted: () => {},
      onSelected: () => {},
      onDanglingPipe: () => {},
    };

    this.canvas = new X6Canvas(canvasEl, noopEvents);
    this.canvas.setReadonly(true);

    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w > 0 && h > 0) this.canvas.resize(w, h);

    effect(() => {
      this.renderComposite();
      this.updateSystemEntries();
    }, { injector: this.injector });

    // Click or double-click any node/boundary to navigate to its controller
    const handleCellClick = ({ cell }: any) => {
      const id: string = cell.id;
      if (id.startsWith('boundary-')) {
        this.navigateToSystem(id.replace('boundary-', ''));
        return;
      }
      const data = cell.getData?.() as Record<string, unknown> | undefined;
      const anchorId = data?.['anchorId'] as string | undefined;
      if (anchorId) {
        this.navigateToSystem(anchorId);
      }
    };
    this.canvas.graphInstance.on('node:click', handleCellClick);
    this.canvas.graphInstance.on('node:dblclick', handleCellClick);
    this.canvas.graphInstance.on('cell:click', ({ cell }: any) => {
      // cell:click catches boundaries (which are nodes) and edges
      if (cell.isNode?.()) handleCellClick({ cell });
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.canvas?.resize(canvasWrap.clientWidth, canvasWrap.clientHeight);
    });
    this.resizeObserver.observe(canvasWrap);
  }

  private renderComposite() {
    const topology = this.workspace.siteTopology();
    if (!this.canvas || !topology || topology.nodes.length === 0) return;

    this.canvas.reset(topology);
    const friendlyNames = new Map<string, string>();
    for (const ctrl of topology.controllers) {
      friendlyNames.set(ctrl.id, ctrl.friendlyName ?? ctrl.id);
    }
    renderCompositeOverlays(this.canvas.graphInstance, topology, {
      friendlyNames,
    });
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }
}
