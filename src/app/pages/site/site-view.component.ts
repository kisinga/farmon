import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewInit, NgZone, Injector, effect,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ElectronService } from '../../core/services/electron.service';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import { renderBoundaries, BOUNDARY_COLORS } from '../../shared/canvas/boundary-renderer';

@Component({
  selector: 'app-site-view',
  standalone: true,
  host: { class: 'flex-1 flex overflow-hidden' },
  template: `
    <!-- Left pane: system list -->
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
                @if (workspace.dirtySystemIds().has(entry.id)) {
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
        @if (siteDocHtml()) {
          <button class="btn btn-ghost btn-xs gap-1" (click)="showingDocs.set(!showingDocs())"
            [class.btn-active]="showingDocs()">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Docs
          </button>
        }
        <button class="btn btn-ghost btn-xs gap-1" (click)="generateSiteDocs()" [disabled]="generatingDocs()">
          @if (generatingDocs()) { <span class="loading loading-spinner loading-xs"></span> }
          Generate Docs
        </button>
        <div class="divider divider-horizontal mx-0 h-4"></div>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomIn()" title="Zoom in">+</button>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomOut()" title="Zoom out">&minus;</button>
        <button class="btn btn-ghost btn-xs" (click)="fit()" title="Fit content">Fit</button>
      </div>
      @if (workspace.unlinkedInterconnects().length > 0) {
        <div class="alert alert-warning text-xs mx-4 mt-2 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <span class="font-medium">Unlinked interconnect{{ workspace.unlinkedInterconnects().length > 1 ? 's' : '' }}:</span>
            @for (h of workspace.unlinkedInterconnects(); track h.nodeId) {
              <span class="font-mono">{{ h.nodeName }} ({{ h.systemId }})</span>{{ !$last ? ', ' : '' }}
            }
            — open each controller's designer to configure the link.
          </div>
        </div>
      }
      @if (showingDocs() && siteDocHtml()) {
        <div class="flex-1 min-h-0 overflow-hidden">
          <iframe [srcdoc]="siteDocHtml()" class="w-full h-full border-0"></iframe>
        </div>
      } @else {
        <div class="flex-1 min-h-0 overflow-hidden" #canvasWrap>
          <div #canvasEl class="w-full h-full"></div>
        </div>
      }
    </div>

    <!-- Right pane: derived routes grouped by system -->
    <div class="w-72 shrink-0 bg-base-100 border-l border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">
        Routes ({{ workspace.compositeRoutes().length }})
      </div>
      <div class="flex-1 overflow-auto">
        @for (group of routeGroups(); track group.systemId) {
          <!-- System group header -->
          <div class="px-3 py-1.5 flex items-center gap-2 border-b border-base-300/20 sticky top-0 bg-base-100 z-10">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" [style.backgroundColor]="group.color"></div>
            <span class="text-[11px] font-semibold truncate" [style.color]="group.color">{{ group.friendlyName }}</span>
            <span class="text-[10px] text-base-content/30 ml-auto">{{ group.routes.length }}</span>
          </div>
          <!-- Routes in this system -->
          @for (route of group.routes; track route.key) {
            <div class="pl-6 pr-3 py-1.5 text-xs border-b border-base-300/10 hover:bg-base-200/40 transition-colors"
                 [style.borderLeftColor]="group.color"
                 style="border-left-width: 2px;">
              <div class="font-mono text-[11px] leading-snug break-all" [style.color]="group.color">
                {{ route.displaySource }}
                <span class="text-base-content/30">&rsaquo;</span>
                {{ route.displayDest }}
              </div>
              @if (route.crossSystem) {
                <div class="text-[10px] text-base-content/30 italic">via {{ route.destSystem }}</div>
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
        @if (workspace.compositeRoutes().length === 0) {
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
  private electron = inject(ElectronService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private injector = inject(Injector);

  @ViewChild('canvasEl') canvasElRef!: ElementRef<HTMLElement>;
  @ViewChild('canvasWrap') canvasWrapRef!: ElementRef<HTMLElement>;

  protected loading = signal(true);
  protected generatingDocs = signal(false);
  protected siteDocHtml = signal<string | null>(null);
  protected showingDocs = signal(false);

  private canvas: X6Canvas | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private siteName: string | null = null;

  protected systemEntries = signal<Array<{ id: string; friendlyName: string; board: string; nodeCount: number }>>([]);

  /** Routes grouped by source system, with boundary colors and clean display names. */
  protected routeGroups = computed(() => {
    const routes = this.workspace.compositeRoutes();
    const systems = this.workspace.systems();

    // Build system ID → color + friendly name map (same order as boundary renderer)
    const systemIds = [...systems.keys()];
    const systemColor = new Map<string, string>();
    const systemFriendly = new Map<string, string>();
    systemIds.forEach((id, i) => {
      systemColor.set(id, BOUNDARY_COLORS[i % BOUNDARY_COLORS.length]);
      systemFriendly.set(id, systems.get(id)?.topology.device.friendly_name ?? id);
    });

    // Group routes by source system
    const groups = new Map<string, Array<{
      key: string; displaySource: string; displayDest: string;
      crossSystem: boolean; destSystem: string;
      valveCount: number; hasPump: boolean; valid: boolean;
    }>>();

    for (const route of routes) {
      const srcSystem = route.source.split('/')[0];
      const destSystem = route.destination.split('/')[0];
      const srcNode = route.source.split('/').slice(1).join('/');
      const destNode = route.destination.split('/').slice(1).join('/');

      const entry = {
        key: route.key,
        displaySource: srcNode,
        displayDest: destNode,
        crossSystem: srcSystem !== destSystem,
        destSystem: systemFriendly.get(destSystem) ?? destSystem,
        valveCount: route.valves.length,
        hasPump: route.crossesPump,
        valid: route.valid,
      };

      const arr = groups.get(srcSystem) ?? [];
      arr.push(entry);
      groups.set(srcSystem, arr);
    }

    return systemIds
      .filter(id => groups.has(id))
      .map(id => ({
        systemId: id,
        friendlyName: systemFriendly.get(id) ?? id,
        color: systemColor.get(id) ?? '#666',
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
    const entries: Array<{ id: string; friendlyName: string; board: string; nodeCount: number }> = [];
    for (const [id, { topology }] of this.workspace.systems()) {
      entries.push({
        id,
        friendlyName: topology.device.friendly_name,
        board: topology.device.board,
        nodeCount: topology.nodes.length,
      });
    }
    this.systemEntries.set(entries);
  }

  protected async deleteSystem(systemId: string, friendlyName: string, event: Event) {
    event.stopPropagation();
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Controller',
      message: `Delete "${friendlyName}"? All links to/from this controller will also be removed.`,
    });
    if (!confirmed) return;
    if (this.workspace.activeSystemId() === systemId) {
      this.workspace.unfocusSystem();
    }
    this.workspace.removeSystem(systemId);
    this.updateSystemEntries();
  }

  protected navigateToSystem(systemId: string) {
    this.zone.run(() => {
      this.router.navigate(['/site', this.siteName, 'system', systemId]);
    });
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

    this.canvas.graphInstance.on('node:click', ({ node }: any) => {
      const id: string = node.id;
      if (id.startsWith('boundary-')) {
        const systemId = id.replace('boundary-', '');
        this.navigateToSystem(systemId);
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.canvas?.resize(canvasWrap.clientWidth, canvasWrap.clientHeight);
    });
    this.resizeObserver.observe(canvasWrap);
  }

  private renderComposite() {
    const composite = this.workspace.compositeTopology();
    if (!this.canvas || !composite || composite.nodes.length === 0) return;

    this.canvas.reset(composite);

    const graph = this.canvas.graphInstance;
    const systems = this.workspace.systems();
    const links = this.workspace.links();

    // Build boundary groups
    const systemNodes = new Map<string, string[]>();
    const friendlyNames = new Map<string, string>();
    for (const [systemId, { topology }] of systems) {
      systemNodes.set(systemId, topology.nodes.map(n => `${systemId}/${n.id}`));
      friendlyNames.set(systemId, topology.device.friendly_name);
    }
    renderBoundaries(graph, systemNodes, friendlyNames);

    // Style inter-system link edges as dashed
    for (const link of links) {
      const edge = graph.getCellById(`pipe-link-${link.id}`);
      if (edge?.isEdge()) {
        edge.setAttrs({
          line: {
            stroke: '#8b5cf6',
            strokeWidth: 2,
            strokeDasharray: '8,4',
            targetMarker: { name: 'classic', size: 8 },
          },
        });
      }
    }

    // Resize interconnect nodes that have connection labels (compositeTopology injects _connectionLabel)
    for (const node of composite.nodes) {
      if (node.kind !== 'interconnect' || !(node as any)._connectionLabel) continue;
      const cell = graph.getCellById(`node-${node.id}`);
      if (cell?.isNode()) {
        const size = cell.getSize();
        if (size.height < 66) cell.resize(size.width, 66);
      }
    }
  }

  protected async generateSiteDocs() {
    if (!this.canvas || !this.workspace.site()) return;
    this.generatingDocs.set(true);
    try {
      const compositeSvg = await this.canvas.exportSvg();
      const siteId = this.workspace.site()!.id;

      // Build system data for the IPC call
      const systems: Array<{ systemId: string; friendlyName: string; board: string; deviceName: string; topology: unknown }> = [];
      for (const [id, { topology }] of this.workspace.systems()) {
        systems.push({
          systemId: id,
          friendlyName: topology.device.friendly_name,
          board: topology.device.board,
          deviceName: topology.device.name,
          topology,
        });
      }

      const links = this.workspace.links();
      const routes = this.workspace.compositeRoutes();

      const result = await this.electron.generateSiteDocs(siteId, compositeSvg, systems, links, routes);
      this.siteDocHtml.set(result.html);
      this.showingDocs.set(true);
    } finally {
      this.generatingDocs.set(false);
    }
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }
}
