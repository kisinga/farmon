import {
  Component, inject, OnInit, OnDestroy, signal,
  ElementRef, ViewChild, AfterViewInit, NgZone, Injector, effect,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import { renderBoundaries } from '../../shared/canvas/boundary-renderer';

@Component({
  selector: 'app-site-view',
  standalone: true,
  host: { class: 'flex-1 flex overflow-hidden' },
  template: `
    <!-- Left pane: system list -->
    <div class="w-56 shrink-0 bg-base-100 border-r border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">Systems</div>
      <div class="flex-1 overflow-auto">
        @for (entry of systemEntries(); track entry.id) {
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-base-200/60 transition-colors border-b border-base-300/10 group"
            (click)="navigateToSystem(entry.id)"
          >
            <div class="font-medium truncate">{{ entry.friendlyName }}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-base-content/40 font-mono">{{ entry.board }}</span>
              <span class="text-[10px] text-base-content/30">{{ entry.nodeCount }} nodes</span>
            </div>
          </button>
        }
        @if (systemEntries().length === 0) {
          <div class="px-3 py-6 text-xs text-base-content/30 text-center">
            No systems yet. Click "Add System" above.
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
      @if (workspace.unlinkedHandoffs().length > 0) {
        <div class="alert alert-warning text-xs mx-4 mt-2 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <span class="font-medium">Unlinked handoff{{ workspace.unlinkedHandoffs().length > 1 ? 's' : '' }}:</span>
            @for (h of workspace.unlinkedHandoffs(); track h.nodeId) {
              <span class="font-mono">{{ h.nodeName }} ({{ h.systemId }})</span>{{ !$last ? ', ' : '' }}
            }
            — open each system's designer to configure the link.
          </div>
        </div>
      }
      <div class="flex-1 min-h-0 overflow-hidden" #canvasWrap>
        <div #canvasEl class="w-full h-full"></div>
      </div>
    </div>

    <!-- Right pane: derived routes -->
    <div class="w-64 shrink-0 bg-base-100 border-l border-base-300/30 flex flex-col overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold text-base-content/50 border-b border-base-300/20">
        Routes ({{ workspace.compositeRoutes().length }})
      </div>
      <div class="flex-1 overflow-auto">
        @for (route of workspace.compositeRoutes(); track route.key) {
          <div class="px-3 py-2 text-xs border-b border-base-300/10 hover:bg-base-200/40 transition-colors">
            <div class="font-mono font-medium truncate" title="{{ route.key }}">
              {{ route.key }}
            </div>
            <div class="flex items-center gap-2 mt-0.5 text-[10px] text-base-content/40">
              <span>{{ route.valves.length }} valve{{ route.valves.length !== 1 ? 's' : '' }}</span>
              @if (route.crossesPump) {
                <span class="badge badge-ghost badge-xs">pump</span>
              }
              @if (!route.valid) {
                <span class="badge badge-error badge-xs">no sensor</span>
              }
            </div>
          </div>
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

    const systemNodes = new Map<string, string[]>();
    const friendlyNames = new Map<string, string>();
    for (const [systemId, { topology }] of this.workspace.systems()) {
      systemNodes.set(systemId, topology.nodes.map(n => `${systemId}/${n.id}`));
      friendlyNames.set(systemId, topology.device.friendly_name);
    }
    renderBoundaries(this.canvas.graphInstance, systemNodes, friendlyNames);
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }
}
