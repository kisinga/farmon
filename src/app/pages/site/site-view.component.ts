import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewInit, NgZone,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SiteEditorService } from '../../core/services/site-editor.service';
import { LibraryService } from '../../core/services/library.service';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import type { SystemTopology, TopologyNode, PipeSegment } from '../../core/models/topology.model';

/** Separator for namespacing IDs (avoids / in X6 DOM selectors). */
const NS = '--';

@Component({
  selector: 'app-site-view',
  standalone: true,
  host: { class: 'flex-1 flex overflow-hidden' },
  template: `
    <!-- Sidebar -->
    <aside class="w-64 bg-base-100 border-r border-base-300/40 flex flex-col shrink-0 overflow-hidden">
      @if (siteEditor.site(); as site) {
        <!-- Site header -->
        <div class="px-4 py-4 border-b border-base-300/30">
          <h2 class="font-bold text-base truncate">{{ site.friendly_name }}</h2>
          <p class="text-xs text-base-content/50 mt-0.5">
            {{ site.systems.length }} system{{ site.systems.length !== 1 ? 's' : '' }}
          </p>
        </div>

        <!-- Actions -->
        <div class="px-3 py-2 border-b border-base-300/30 flex gap-2">
          <button class="btn btn-sm btn-ghost flex-1" (click)="showAddSystem.set(true)">+ Add</button>
          @if (siteEditor.dirty()) {
            <button class="btn btn-sm btn-primary flex-1" (click)="save()">Save</button>
          }
        </div>

        <!-- System list -->
        <div class="flex-1 overflow-y-auto">
          @for (sp of site.systems; track sp.config) {
            @if (getSystem(sp.config); as sys) {
              <div
                class="px-3 py-3 border-b border-base-300/20 cursor-pointer transition-colors"
                [class.bg-primary/5]="selectedSystem() === sp.config"
                [class.border-l-2]="selectedSystem() === sp.config"
                [class.border-l-primary]="selectedSystem() === sp.config"
                (click)="selectSystem(sp.config)"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium truncate">
                    {{ sys.topology.device.friendly_name || sp.config }}
                  </span>
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    [class.bg-success]="sp.checksum !== ''"
                    [class.bg-warning]="sp.checksum === ''"
                  ></span>
                </div>
                <div class="flex items-center gap-2 mt-1">
                  <span class="badge badge-xs badge-ghost">{{ sys.topology.device.board }}</span>
                  <span class="text-[10px] text-base-content/40">
                    {{ nodeCount(sys.topology, 'tank') }}T {{ nodeCount(sys.topology, 'valve') }}V
                  </span>
                </div>
                <div class="flex gap-1 mt-2">
                  <button
                    class="btn btn-xs btn-primary btn-outline flex-1"
                    (click)="openSystem(sp.config, $event)"
                  >Open</button>
                  <button
                    class="btn btn-xs btn-ghost text-error/50 hover:text-error"
                    (click)="removeSystem(sp.config, $event)"
                  >Remove</button>
                </div>
              </div>
            }
          }

          @if (site.systems.length === 0) {
            <div class="p-6 text-center text-base-content/30">
              <p class="text-sm">No systems yet</p>
              <button class="btn btn-sm btn-primary mt-3" (click)="showAddSystem.set(true)">Add System</button>
            </div>
          }
        </div>

        <!-- Footer -->
        @if (siteEditor.stale()) {
          <div class="px-3 py-2 border-t border-base-300/30">
            <button class="btn btn-sm btn-warning w-full" (click)="rebuild()">Rebuild</button>
          </div>
        }
      } @else {
        <div class="flex-1 flex items-center justify-center">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
      }
    </aside>

    <!-- Canvas area -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 px-4 py-2 bg-base-100 border-b border-base-300/50 shrink-0">
        <span class="text-xs text-base-content/50 flex-1">Site topology</span>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomIn()" title="Zoom in">+</button>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomOut()" title="Zoom out">&minus;</button>
        <button class="btn btn-ghost btn-xs" (click)="fit()" title="Fit content">Fit</button>
      </div>
      <!-- X6 canvas container -->
      <div class="flex-1 min-h-0 overflow-hidden" #canvasWrap>
        <div #canvasEl class="w-full h-full"></div>
      </div>
    </div>

    <!-- Add system dialog -->
    @if (showAddSystem()) {
      <dialog class="modal modal-open">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Add System</h3>
          @if (availableConfigs().length === 0) {
            <p class="text-sm text-base-content/40 py-6 text-center">No available configs.</p>
          } @else {
            <div class="space-y-1 max-h-60 overflow-auto">
              @for (entry of availableConfigs(); track entry.name) {
                <button
                  class="btn btn-ghost btn-sm w-full justify-start gap-3 font-normal"
                  (click)="addSystem(entry.name)"
                >
                  <span class="font-medium">{{ entry.friendlyName || entry.name }}</span>
                  <span class="text-xs text-base-content/40 font-mono">{{ entry.board }}</span>
                </button>
              }
            </div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="showAddSystem.set(false)">Cancel</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="showAddSystem.set(false)"></div>
      </dialog>
    }
  `,
})
export class SiteViewComponent implements OnInit, AfterViewInit, OnDestroy {
  protected siteEditor = inject(SiteEditorService);
  private libraryService = inject(LibraryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);

  @ViewChild('canvasEl') canvasElRef!: ElementRef<HTMLElement>;
  @ViewChild('canvasWrap') canvasWrapRef!: ElementRef<HTMLElement>;

  protected loading = signal(true);
  protected showAddSystem = signal(false);
  protected selectedSystem = signal<string | null>(null);
  protected availableConfigs = signal<Array<{ name: string; friendlyName: string; board: string }>>([]);

  private canvas: X6Canvas | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // --- Lifecycle ---

  async ngOnInit() {
    const siteName = this.route.snapshot.paramMap.get('name');
    if (!siteName) { this.router.navigate(['/overview']); return; }

    await this.siteEditor.load(siteName);
    await this.refreshAvailableConfigs();
    this.loading.set(false);
  }

  ngAfterViewInit() {
    // Wait for site to be loaded, then init canvas
    const checkAndInit = () => {
      if (!this.siteEditor.site() || !this.canvasElRef) {
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
    this.siteEditor.clear();
  }

  // --- Canvas ---

  private initCanvas() {
    const noopEvents: CanvasEvents = {
      onNodesMoved: () => {},
      onPipeCreated: () => {},
      onPipeDeleted: () => {},
      onSelected: (sel) => {
        // When a node is clicked, find which system owns it
        if (sel?.kind === 'node') {
          const parts = sel.nodeId.split(NS);
          if (parts.length >= 2) this.selectedSystem.set(parts[0]);
        }
      },
      onDanglingPipe: () => {},
    };

    this.zone.runOutsideAngular(() => {
      this.canvas = new X6Canvas(this.canvasElRef.nativeElement, noopEvents);
      this.canvas.setReadonly(true);

      const composite = this.buildCompositeTopology();
      if (composite.nodes.length > 0) {
        this.canvas.reset(composite);
        // Add boundary rectangles after render
        this.addSystemBoundaries();
      }

      // Resize tracking
      this.resizeObserver = new ResizeObserver(() => {
        const wrap = this.canvasWrapRef.nativeElement;
        this.canvas?.resize(wrap.clientWidth, wrap.clientHeight);
      });
      this.resizeObserver.observe(this.canvasWrapRef.nativeElement);
    });
  }

  /**
   * Build a synthetic SystemTopology merging all systems.
   * Node IDs are namespaced as "configName--nodeId" to avoid collisions.
   */
  private buildCompositeTopology(): SystemTopology {
    const allNodes: TopologyNode[] = [];
    const allPipes: PipeSegment[] = [];
    const systems = this.siteEditor.loadedSystems();
    const site = this.siteEditor.site();

    let systemIdx = 0;
    for (const [config, { topology }] of systems) {
      // Get placement offset from site, default to grid layout
      const placement = site?.systems.find(s => s.config === config);
      const offsetX = placement?.position.x || (systemIdx % 3) * 600;
      const offsetY = placement?.position.y || Math.floor(systemIdx / 3) * 500;

      for (const node of topology.nodes) {
        allNodes.push({
          ...node,
          id: `${config}${NS}${node.id}`,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          },
          ports: node.ports.map(p => ({
            ...p,
            id: `${config}${NS}${p.id}`,
          })),
        } as TopologyNode);
      }

      for (const pipe of topology.pipes) {
        const [fromNode, fromPort] = pipe.from.split(':');
        const [toNode, toPort] = pipe.to.split(':');
        allPipes.push({
          id: `${config}${NS}${pipe.id}`,
          from: `${config}${NS}${fromNode}:${config}${NS}${fromPort}`,
          to: `${config}${NS}${toNode}:${config}${NS}${toPort}`,
        });
      }

      systemIdx++;
    }

    return {
      schema: 8,
      device: { name: 'composite', friendly_name: 'Site', board: '' },
      nodes: allNodes,
      pipes: allPipes,
      route_overrides: {},
      timing: {
        valve_travel_time: '0s',
        flow_watchdog_seconds: 0,
        flow_confirm_seconds: 0,
        api_watchdog_seconds: 0,
        update_interval: '0s',
      },
      automations: [],
    };
  }

  /** Add semi-transparent boundary rectangles around each system's nodes. */
  private addSystemBoundaries() {
    if (!this.canvas) return;
    const graph = this.canvas.graphInstance;
    const systems = this.siteEditor.loadedSystems();
    const PADDING = 30;
    const COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

    let colorIdx = 0;
    for (const [config] of systems) {
      const prefix = `node-${config}${NS}`;
      const nodes = graph.getNodes().filter(n => String(n.id).startsWith(prefix));
      if (nodes.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const pos = n.getPosition();
        const size = n.getSize();
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + size.width);
        maxY = Math.max(maxY, pos.y + size.height);
      }

      const color = COLORS[colorIdx % COLORS.length];
      graph.addNode({
        id: `boundary-${config}`,
        x: minX - PADDING,
        y: minY - PADDING - 20,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2 + 20,
        zIndex: -1,
        attrs: {
          body: {
            fill: `${color}08`,
            stroke: color,
            strokeWidth: 1.5,
            strokeDasharray: '6,3',
            rx: 8,
            ry: 8,
          },
          label: {
            text: config,
            fill: color,
            fontSize: 11,
            fontWeight: 'bold',
            refX: PADDING,
            refY: 12,
            textAnchor: 'start',
          },
        },
      });
      colorIdx++;
    }
  }

  // --- Helpers ---

  protected getSystem(config: string) {
    return this.siteEditor.loadedSystems().get(config) ?? null;
  }

  protected nodeCount(topology: { nodes?: Array<{ kind: string }> }, kind: string): number {
    return topology.nodes?.filter(n => n.kind === kind).length ?? 0;
  }

  // --- Actions ---

  protected selectSystem(config: string) {
    this.selectedSystem.set(config);
    if (!this.canvas) return;
    const graph = this.canvas.graphInstance;
    const prefix = `node-${config}${NS}`;
    const nodes = graph.getNodes().filter(n => String(n.id).startsWith(prefix));
    if (nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const pos = n.getPosition();
      const size = n.getSize();
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }

    graph.zoomToRect({ x: minX - 60, y: minY - 60, width: maxX - minX + 120, height: maxY - minY + 120 });
  }

  protected openSystem(config: string, event: Event) {
    event.stopPropagation();
    const siteName = this.route.snapshot.paramMap.get('name');
    this.router.navigate(['/site', siteName, 'system', config]);
  }

  protected async addSystem(configName: string) {
    const offset = this.siteEditor.site()?.systems.length ?? 0;
    await this.siteEditor.addSystem(configName, { x: (offset % 3) * 600, y: Math.floor(offset / 3) * 500 });
    await this.refreshAvailableConfigs();
    this.showAddSystem.set(false);
    // Re-render canvas
    if (this.canvas) {
      const composite = this.buildCompositeTopology();
      this.canvas.reset(composite);
      this.addSystemBoundaries();
    }
  }

  protected async removeSystem(config: string, event: Event) {
    event.stopPropagation();
    this.siteEditor.removeSystem(config);
    await this.refreshAvailableConfigs();
    if (this.canvas) {
      const composite = this.buildCompositeTopology();
      this.canvas.reset(composite);
      this.addSystemBoundaries();
    }
  }

  protected async rebuild() {
    await this.siteEditor.rebuild();
    if (this.canvas) {
      const composite = this.buildCompositeTopology();
      this.canvas.reset(composite);
      this.addSystemBoundaries();
    }
  }

  protected async save() {
    await this.siteEditor.save();
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }

  private async refreshAvailableConfigs() {
    await this.libraryService.refresh();
    const site = this.siteEditor.site();
    const inSite = new Set(site?.systems.map(s => s.config) ?? []);
    this.availableConfigs.set(
      this.libraryService.entries()
        .filter(e => !inSite.has(e.name))
        .map(e => ({ name: e.name, friendlyName: e.friendlyName, board: e.board }))
    );
  }
}
