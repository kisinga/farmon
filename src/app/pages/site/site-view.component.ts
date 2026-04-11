import {
  Component, inject, OnInit, OnDestroy, signal,
  ElementRef, ViewChild, AfterViewInit, NgZone,
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
  `,
})
export class SiteViewComponent implements OnInit, AfterViewInit, OnDestroy {
  private workspace = inject(WorkspaceService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);

  @ViewChild('canvasEl') canvasElRef!: ElementRef<HTMLElement>;
  @ViewChild('canvasWrap') canvasWrapRef!: ElementRef<HTMLElement>;

  protected loading = signal(true);

  private canvas: X6Canvas | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private siteName: string | null = null;

  async ngOnInit() {
    this.siteName = this.route.snapshot.paramMap.get('name');
    if (!this.siteName) { this.router.navigate(['/overview']); return; }
    await this.workspace.load(this.siteName);
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

    // Resize to actual container before rendering
    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w > 0 && h > 0) this.canvas.resize(w, h);

    this.renderComposite();

    // Navigate to device editor when clicking a system boundary
    this.canvas.graphInstance.on('node:click', ({ node }: any) => {
      const id: string = node.id;
      if (id.startsWith('boundary-')) {
        const config = id.replace('boundary-', '');
        this.zone.run(() => {
          this.router.navigate(['/site', this.siteName, 'system', config]);
        });
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
    for (const [config, { topology }] of this.workspace.systems()) {
      systemNodes.set(config, topology.nodes.map(n => n.id));
    }
    renderBoundaries(this.canvas.graphInstance, systemNodes);
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }
}
